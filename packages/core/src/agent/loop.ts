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
import { makeLogger } from '../utils/logger.js'
import type { HostAdapter } from '../host/interface.js'
import type { LLMProvider, Message, OllamaToolCall } from '../providers/types.js'
import type { CaptainSettings } from '../settings/types.js'
import osName from 'os-name'
import defaultShell from 'default-shell'
import { readFile } from 'fs/promises'
import { join } from 'path'

const log = makeLogger('Core')

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

// [흐름 6] main.ts의 user_message 핸들러에서 호출
// LLM 호출 → 도구 실행 → 재호출 사이클을 반복하는 핵심 에이전트 루프
export async function runLoop(input: RunLoopInput): Promise<string | null> {
  abortController = new AbortController()
  const signal = abortController.signal
  const { userText, host, provider } = input

  let finalContent: string | null = null

  log.debug('Loop 1. Starting context gathering')
  try {
    // IDE에서 현재 열린 파일 목록을 컨텍스트로 수집 (IpcHostAdapter → Kotlin → IDE)
    const openFiles = await host.getOpenFiles().catch((e) => {
      log.error('host.getOpenFiles error:', e)
      return []
    })
    log.debug('Loop 2. Got open files:', openFiles.length)

    const rulesPath = join(host.getProjectRoot(), '.captain', 'rules.md')
    const rules = await readFile(rulesPath, 'utf-8').catch(() => '')

    // 프로젝트 메모리 로드 (이전 대화 요약 등)
    const rawMemory = await loadMemory(host.getProjectRoot())
    const memory = trimMemoryForContext(rawMemory, 8000)
    log.debug('Loop 3. Context fully assembled, memory:', rawMemory.length, 'chars')

    // 첫 번째 LLM 호출용 메시지 배열 구성:
    // [system prompt] + [이전 대화 히스토리] + [현재 사용자 메시지]
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

    // 도구 호출이 없는 최종 응답이 올 때까지 LLM ↔ 도구 사이클을 반복
    while (iterations++ < MAX_ITERATIONS) {
      if (signal.aborted) break

      // ── 스티어링 큐 처리 ──
      // 실행 중 사용자가 추가 지시를 주입한 경우 메시지에 삽입
      while (steeringQueue.length > 0) {
        const injected = steeringQueue.shift()!
        log.debug('Steering inject:', injected)
        messages.push({ role: 'user', content: `[User Steering] ${injected}` })
      }

      // ── 3-Tier 압축 ──
      // 컨텍스트 윈도우 초과 시 오래된 메시지를 요약하여 압축
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
        // messages 배열을 압축된 버전으로 교체
        messages.length = 0
        messages.push(...compacted.messages)
      }

      // ── LLM 스트리밍 호출 ──
      let response
      log.debug('Loop 4. Sending to provider (iteration', iterations, ')')
      // UI에 스트리밍 시작 알림 → App.tsx의 stream_start 핸들러 실행
      host.emit('stream_start', { source: 'chat' })
      try {
        // [흐름 6-a] provider.stream() → Ollama/OpenAI/Anthropic HTTP 스트리밍
        // onChunk 콜백: 토큰 수신마다 host.emit('stream_chunk') → IPC stdout → UI
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

      // 스트리밍 완료 알림 → App.tsx의 stream_end 핸들러 → STREAM_END reducer → isBusy 해제
      host.emit('stream_end', {})

      if (!response.tool_calls?.length) {
        // 이번 루프에서 도구가 한 번도 사용되지 않았고 아직 재시도 안 했으면 재시도
        const hasToolsInHistory = messages.some(m => m.role === 'tool')
        if (!hasToolsInHistory && !noToolRetried) {
          noToolRetried = true
          log.debug('Loop: no tools called, injecting retry steering')
          messages.push(response)
          messages.push({
            role: 'user',
            content: '도구를 사용하여 실제로 파일을 수정해주세요. 코드를 텍스트로 설명하지 말고, read_file로 파일을 읽은 뒤 edit_file 또는 write_file로 직접 변경을 수행하세요.',
          })
          continue
        }
        // 도구 호출 없음 → 최종 답변. 루프 종료
        finalContent = typeof response.content === 'string' ? response.content : null
        break
      }

      // 도구 호출이 있으면 assistant 메시지를 히스토리에 추가
      messages.push(response)

      // ── 도구 실행 (병렬/직렬 자동 분류) ──
      // [흐름 6-b] concurrencySafe 도구는 병렬, 쓰기/터미널 도구는 직렬 실행
      // 실행 결과는 tool role 메시지로 messages에 추가 → 다음 LLM 호출 컨텍스트로 전달
      await dispatchTools(response.tool_calls, messages, host, signal)

      if (signal.aborted) break

      // 도구 실행 후 현재 컨텍스트 토큰 사용량을 UI에 전달
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
// [흐름 6-b] LLM이 반환한 tool_calls를 병렬/직렬로 분류해 실행
// 실행 결과를 messages에 tool role로 추가 → 다음 루프 iteration에서 LLM 컨텍스트로 전달
async function dispatchTools(
  calls: OllamaToolCall[],
  messages: Message[],
  host: HostAdapter,
  signal: AbortSignal
): Promise<void> {
  // concurrencySafe 여부로 병렬/직렬 분류
  // 읽기 전용(read_file, grep 등)은 병렬, 파일 쓰기/터미널은 직렬
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
      // tool 결과를 messages에 추가 (다음 LLM 호출 시 컨텍스트로 포함됨)
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

// 단일 도구 실행: UI 이벤트 발행(tool_start/tool_result) + 실제 도구 로직 호출
async function executeSingleTool(
  call: OllamaToolCall,
  host: HostAdapter,
  signal: AbortSignal
): Promise<unknown> {
  if (signal.aborted) return { error: 'Aborted' }

  // UI에 도구 실행 시작 알림 → App.tsx의 tool_start 핸들러 → 타임라인에 tool_start 엔트리 추가
  host.emit('tool_start', { tool: call.function.name, args: call.function.arguments })
  try {
    // 도구 레지스트리에서 핸들러를 찾아 실행 (read_file, write_file, run_terminal 등)
    const result = await toolRegistry.dispatch(call, host, signal)
    // UI에 도구 결과 알림 → COMPLETE_TOOL reducer → tool_start 엔트리에 result 병합
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
