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
 * 무한 루프 방지를 위한 안전장치. 일반적인 작업은 20회 이내에 완료됩니다.
 */
const MAX_ITERATIONS = 100

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

export async function runLoop(input: RunLoopInput): Promise<string | null> {
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
    let noToolRetried = false

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
      host.emit('stream_start', { source: 'chat' })
      try {
        response = await provider.stream(
          messages,
          toolRegistry.getToolDefinitions(),
          (chunk) => {
            if (signal.aborted) return
            if (chunk.token) host.emit('stream_chunk', { token: chunk.token })
          },
          signal
        )
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

      if (!response.tool_calls?.length) {
        const hasToolsInHistory = messages.some(m => m.role === 'tool')
        if (!hasToolsInHistory && !noToolRetried) {
          noToolRetried = true
          log.debug('Loop: no tools called, injecting self-judgment retry steering')
          messages.push(response)
          messages.push({
            role: 'user',
            content: '앞의 요청이 실제 파일 변경(코드 추가·수정·삭제)을 원하는 것이라면, read_file로 파일을 읽은 뒤 edit_file 또는 write_file로 직접 수정해주세요. 설명이나 질문 답변이 목적이었다면 이전 응답으로 충분하니 추가 작업은 필요 없습니다.',
          })
          continue
        }
        finalContent = typeof response.content === 'string' ? response.content : null
        break
      }
      messages.push(response)

      await dispatchTools(response.tool_calls, messages, host, signal)

      if (signal.aborted) break
      const userRejected = messages.some(m => {
        if (m.role !== 'tool') return false
        try { return (JSON.parse(m.content as string) as any).__userRejected === true } catch { return false }
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

  } catch (e: any) {
    host.emit('error', { message: `에이전트 오류: ${e?.message}`, retryable: false })
  }

  return finalContent
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


