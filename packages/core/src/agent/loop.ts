/**
 * Agent Loop v2 — Claude Code-grade execution engine.
 *
 * Key features:
 * - Parallel dispatch for concurrencySafe tools
 * - 3-Tier context compaction integration
 * - Steering queue for mid-loop user intervention
 * - Memory-aware system prompt
 */

import * as toolRegistry from '../tools/registry.js'
import { buildSystemPrompt } from './context.js'
import { compactMessages } from './compactor.js'
import { loadMemory, trimMemoryForContext } from './memory.js'
import type { HostAdapter } from '../host/interface.js'
import type { LLMProvider, Message, OllamaToolCall } from '../providers/types.js'
import type { CaptainSettings } from '../settings/types.js'
import osName from 'os-name'
import defaultShell from 'default-shell'
import { readFile } from 'fs/promises'
import { join } from 'path'

const MAX_ITERATIONS = Infinity

export interface RunLoopInput {
  userText: string
  host: HostAdapter
  provider: LLMProvider
  history: Message[]
  settings: CaptainSettings
}

// ── Abort / Steering ─────────────────────────────────────────

let abortController: AbortController | null = null

/** 스티어링 큐: 실행 중 사용자가 주입한 메시지 */
const steeringQueue: string[] = []

export function abortLoop() {
  abortController?.abort()
  abortController = null
}

/** 사용자가 루프 실행 중에 추가 지시를 주입합니다. */
export function injectSteering(text: string) {
  steeringQueue.push(text)
}

// ── Main Loop ────────────────────────────────────────────────

export async function runLoop(input: RunLoopInput): Promise<string | null> {
  abortController = new AbortController()
  const signal = abortController.signal
  const { userText, host, provider } = input

  let finalContent: string | null = null

  console.error('[Core Trace] Loop 1. Starting context gathering')
  try {
    // 컨텍스트 조립
    const openFiles = await host.getOpenFiles().catch((e) => {
      console.error('[Core Trace] host.getOpenFiles error:', e)
      return []
    })
    console.error('[Core Trace] Loop 2. Got open files:', openFiles.length)

    const rulesPath = join(host.getProjectRoot(), '.captain', 'rules.md')
    const rules = await readFile(rulesPath, 'utf-8').catch(() => '')

    // 메모리 로드
    const rawMemory = await loadMemory(host.getProjectRoot())
    const memory = trimMemoryForContext(rawMemory, 8000)
    console.error('[Core Trace] Loop 3. Context fully assembled, memory:', rawMemory.length, 'chars')

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

    while (iterations++ < MAX_ITERATIONS) {
      if (signal.aborted) break

      // ── 스티어링 큐 처리 ──
      while (steeringQueue.length > 0) {
        const injected = steeringQueue.shift()!
        console.error('[Core Trace] Steering inject:', injected)
        messages.push({ role: 'user', content: `[User Steering] ${injected}` })
      }

      // ── 3-Tier 압축 ──
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
        // messages 배열을 교체
        messages.length = 0
        messages.push(...compacted.messages)
      }

      // ── LLM 스트리밍 호출 ──
      let response
      console.error('[Core Trace] Loop 4. Sending to provider (iteration', iterations, ')')
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
        console.error('[Core Trace] Loop 5. Provider stream resolved')
      } catch (e: any) {
        console.error('[Core Trace] Loop X. Provider stream error:', e)
        if (signal.aborted) break
        const message = e?.name === 'TimeoutError' || e?.message?.includes('timed out')
          ? `LLM 응답 타임아웃. Ollama가 실행 중인지 확인하세요.`
          : `LLM 오류: ${e?.message || '알 수 없는 오류'}`
        host.emit('error', { message, retryable: true })
        break
      }

      host.emit('stream_end', {})

      if (!response.tool_calls?.length) {  // 도구 없음 → 완료
        finalContent = typeof response.content === 'string' ? response.content : null
        break
      }

      messages.push(response)

      // ── 도구 실행 (병렬/직렬 자동 분류) ──
      await dispatchTools(response.tool_calls, messages, host, signal)

      if (signal.aborted) break

      // ── 컨텍스트 사용량 UI 전달 ──
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

// ── Tool Dispatch (Parallel / Serial) ────────────────────────

/**
 * 도구 호출을 병렬/직렬로 분류하여 실행합니다.
 *
 * 분류 규칙:
 * - concurrencySafe: true → 병렬 실행 가능 (read_file, glob, grep 등)
 * - concurrencySafe: false → 직렬 실행 필수 (write_file, edit_file, run_terminal)
 * - 병렬 그룹을 먼저 모두 처리한 후, 직렬 그룹을 순서대로 처리
 */
async function dispatchTools(
  calls: OllamaToolCall[],
  messages: Message[],
  host: HostAdapter,
  signal: AbortSignal
): Promise<void> {
  // 병렬/직렬 분류
  const parallel: OllamaToolCall[] = []
  const serial: OllamaToolCall[] = []

  for (const call of calls) {
    const def = toolRegistry.getToolDef(call.function.name)
    if (def?.concurrencySafe) {
      parallel.push(call)
    } else {
      serial.push(call)
    }
  }

  // ── 1. 병렬 실행 ──
  if (parallel.length > 0) {
    console.error(`[Core Trace] Dispatching ${parallel.length} tools in parallel`)
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

  // ── 2. 직렬 실행 ──
  for (const call of serial) {
    if (signal.aborted) break
    const result = await executeSingleTool(call, host, signal)
    messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) })
  }
}

/** 단일 도구 실행 + UI 이벤트. */
async function executeSingleTool(
  call: OllamaToolCall,
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

// ── Utilities ────────────────────────────────────────────────

/** 토큰 추정 (1 토큰 ≈ 4 글자 근사치). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/** 메시지 배열의 총 토큰 수. */
function totalTokens(messages: Message[]): number {
  return messages.reduce(
    (sum, m) => sum + estimateTokens(typeof m.content === 'string' ? m.content : JSON.stringify(m)),
    0
  )
}
