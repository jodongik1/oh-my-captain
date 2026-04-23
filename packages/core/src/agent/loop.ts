import * as toolRegistry from '../tools/registry.js'
import { buildSystemPrompt } from './context.js'
import { compactMessages } from './compactor.js'
import { loadMemory, trimMemoryForContext } from './memory.js'
import { estimateTokens, totalTokens } from '../utils/tokens.js'
import { makeLogger } from '../utils/logger.js'
import type { HostAdapter } from '../host/interface.js'
import type { LLMProvider, Message, ToolCall } from '../providers/types.js'
import type { CaptainSettings } from '../settings/types.js'
import osName from 'os-name'
import defaultShell from 'default-shell'
import { readFile } from 'fs/promises'
import { join } from 'path'

const log = makeLogger('loop.ts')

/**
 * 에이전트 루프 최대 반복 횟수.
 * 무한 루프 방지를 위한 안전장치. 일반적인 작업은 15회 이내에 완료됩니다.
 */
const MAX_ITERATIONS = 25

/**
 * 동일 에러 연속 감지 임계값.
 * 같은 도구가 같은 에러를 이 횟수만큼 연속 반환하면 루프를 조기 중단합니다.
 */
const MAX_CONSECUTIVE_ERRORS = 3

export interface RunLoopInput {
  userText: string
  host: HostAdapter
  provider: LLMProvider
  history: Message[]
  settings: CaptainSettings
}

let abortController: AbortController | null = null

const steeringQueue: string[] = []

export function abortLoop() {
  abortController?.abort()
  abortController = null
}
export function injectSteering(text: string) {
  steeringQueue.push(text)
}

export interface RunLoopResult {
  /** 마지막 assistant의 텍스트 응답 (없으면 null) */
  finalContent: string | null
  /** loop 내부에서 쌓인 전체 대화 턴 (system prompt 제외) — chat.ts의 history 동기화용 */
  conversationTurns: Message[]
}

export async function runLoop(input: RunLoopInput): Promise<RunLoopResult> {
  abortController = new AbortController()
  const signal = abortController.signal
  const { userText, host, provider } = input

  let finalContent: string | null = null

  log.debug('Loop 1. Starting context gathering')
  try {
    const openFiles = await host.getOpenFiles().catch((e) => {
      log.error('host.getOpenFiles error:', e)
      return []
    })
    log.debug('Loop 2. Got open files:', openFiles.length)
    log.debug('Loop 2.1 Got open files:', openFiles.map(f => f.path).join(', '))

    const rulesPath = join(host.getProjectRoot(), '.captain', 'rules.md')
    const rules = await readFile(rulesPath, 'utf-8').catch(() => '')
    log.debug('Loop 2.1 Got rules:', rules)

    const rawMemory = await loadMemory(host.getProjectRoot())
    const memory = trimMemoryForContext(rawMemory, 8000)
    log.debug('Loop 3. Context fully assembled, memory:', rawMemory.length, 'chars')

    const messages: Message[] = [
      {
        role: 'system',
        content: await buildSystemPrompt({
          projectRoot: host.getProjectRoot(),
          openFiles,
          rules,
          memory,
          os: osName(),
          shell: defaultShell,
          tools: toolRegistry.getToolDefinitions(),
          mode: host.getMode(),
        }),
      },
      ...input.history,
      { role: 'user', content: userText },
    ]

    let iterations = 0
    // 반복 에러 감지용 상태
    let lastToolError: string | null = null
    let consecutiveErrorCount = 0

    while (iterations++ < MAX_ITERATIONS) {
      if (signal.aborted) break
      while (steeringQueue.length > 0) {
        const injected = steeringQueue.shift()!
        log.debug('Steering inject:', injected)
        messages.push({ role: 'user', content: `[User Steering] ${injected}` })
      }

      const beforeTokens = totalTokens(messages)
      const compacted = await compactMessages(
        messages,
        input.settings.model.contextWindow,
        provider
      )
      if (compacted.tier > 0) {
        const afterTokens = totalTokens(compacted.messages)
        host.emit('compaction', {
          tier: compacted.tier,
          beforeTokens,
          afterTokens,
        })
        messages.length = 0
        messages.push(...compacted.messages)
      }

      let response
      log.debug('Loop 4. Sending to provider (iteration', iterations, ')')
      host.emit('thinking_start', {}) // 생각 시작 알림
      const thinkingStart = Date.now()
      let hasStartedStreaming = false

      host.emit('stream_start', { source: 'chat' })
      try {
        response = await provider.stream(
          messages,
          toolRegistry.getToolDefinitions(),
          (chunk) => {
            if (signal.aborted) return
            
            // 첫 번째 토큰이 오면 '생각 중' 상태를 종료
            if (!hasStartedStreaming && chunk.token) {
              hasStartedStreaming = true
              host.emit('thinking_end', { durationMs: Date.now() - thinkingStart })
            }

            if (chunk.token) host.emit('stream_chunk', { token: chunk.token })
          },
          signal
        )
        // 스트림이 끝났는데 아직 thinking_end를 안 보냈다면 (토큰 없이 종료된 경우 등) 보냄
        if (!hasStartedStreaming) {
          host.emit('thinking_end', { durationMs: Date.now() - thinkingStart })
        }
        log.debug('Loop 5. Provider stream resolved')
      } catch (e: any) {
        log.error('Loop provider stream error:', e)
        if (signal.aborted) break
        const message = e?.name === 'TimeoutError' || e?.message?.includes('timed out')
          ? `LLM 응답 타임아웃. Ollama가 실행 중인지 확인하세요.`
          : `LLM 오류: ${e?.message || '알 수 없는 오류'}`
        host.emit('error', { message, retryable: true })
        break
      }

      host.emit('stream_end', {})

      if (typeof response.content === 'string' && response.content.length > 0) {
        finalContent = response.content
      }

      if (!response.tool_calls?.length) {
        break
      }
      messages.push(response)

      await dispatchTools(response.tool_calls, messages, host, signal)

      // ── 반복 에러 감지 ──
      // 마지막으로 push된 tool 결과 메시지들을 검사하여 동일 에러 연속 발생 여부 확인
      const latestToolResults = messages.slice(-response.tool_calls.length)
      const errorSignatures = latestToolResults
        .filter(m => m.role === 'tool')
        .map(m => {
          try {
            const parsed = JSON.parse(m.content as string)
            return parsed?.error ? `${parsed.error}` : null
          } catch { return null }
        })
        .filter(Boolean)

      if (errorSignatures.length > 0) {
        const currentError = errorSignatures.join('|')
        if (currentError === lastToolError) {
          consecutiveErrorCount++
          log.warn(`반복 에러 감지 (${consecutiveErrorCount}/${MAX_CONSECUTIVE_ERRORS}): ${currentError.slice(0, 100)}`)
          if (consecutiveErrorCount >= MAX_CONSECUTIVE_ERRORS) {
            log.error(`동일 에러 ${MAX_CONSECUTIVE_ERRORS}회 연속 발생 — 루프 조기 중단`)
            host.emit('error', {
              message: `같은 오류가 ${MAX_CONSECUTIVE_ERRORS}회 반복되어 작업을 중단합니다. 다른 방법을 시도해 주세요.`,
              retryable: true,
            })
            break
          }
        } else {
          lastToolError = currentError
          consecutiveErrorCount = 1
        }
      } else {
        // 에러 없는 성공적 도구 실행 → 카운터 리셋
        lastToolError = null
        consecutiveErrorCount = 0
      }

      if (signal.aborted) break
      const currentToolResults = messages.slice(-response.tool_calls.length)
      const userRejected = currentToolResults.some(m => {
        if (m.role !== 'tool') return false
        try {
          const parsed = JSON.parse(m.content as string)
          return parsed?.__userRejected === true
        } catch { return false }
      })
      if (userRejected) break

      const usedTokens = totalTokens(messages)
      const maxTokens = input.settings.model.contextWindow
      host.emit('context_usage', {
        usedTokens,
        maxTokens,
        percentage: Math.round((usedTokens / maxTokens) * 100),
      })
    }

    // system prompt(messages[0])를 제외한 나머지가 실제 대화 턴
    const conversationTurns = messages.slice(1)
    return { finalContent, conversationTurns }

  } catch (e: any) {
    host.emit('error', { message: `에이전트 오류: ${e?.message}`, retryable: false })
    return { finalContent, conversationTurns: [] }
  }
}

async function dispatchTools(
  calls: ToolCall[],
  messages: Message[],
  host: HostAdapter,
  signal: AbortSignal
): Promise<void> {
  const parallel: ToolCall[] = []
  const serial: ToolCall[] = []

  for (const call of calls) {
    const def = toolRegistry.getToolDef(call.function.name)
    if (def?.concurrencySafe) {
      parallel.push(call)
    } else {
      serial.push(call)
    }
  }

  if (parallel.length > 0) {
    log.debug(`Dispatching ${parallel.length} tools in parallel`)
    const parallelResults = await Promise.allSettled(
      parallel.map(call => executeSingleTool(call, host, signal))
    )

    for (let i = 0; i < parallel.length; i++) {
      const call = parallel[i]
      const settled = parallelResults[i]
      const result = settled.status === 'fulfilled'
        ? settled.value
        : { error: (settled.reason as Error)?.message || 'Tool execution failed' }
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) })
    }
  }
  for (const call of serial) {
    if (signal.aborted) break
    const result = await executeSingleTool(call, host, signal)
    messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) })
  }
}

async function executeSingleTool(
  call: ToolCall,
  host: HostAdapter,
  signal: AbortSignal
): Promise<unknown> {
  if (signal.aborted) return { error: 'Aborted' }

  host.emit('tool_start', { tool: call.function.name, args: call.function.arguments })
  try {
    const result = await toolRegistry.dispatch(call, host, signal)
    host.emit('tool_result', { tool: call.function.name, result })
    return result
  } catch (e: any) {
    const errorResult = { error: e?.message || 'Tool execution failed' }
    host.emit('tool_result', { tool: call.function.name, result: errorResult })
    return errorResult
  }
}


