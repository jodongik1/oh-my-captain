import * as toolRegistry from '../tools/registry.js'
import { buildSystemPrompt } from './context.js'
import type { HostAdapter } from '../host/interface.js'
import type { LLMProvider, Message } from '../providers/types.js'
import type { CaptainSettings } from '../settings/types.js'
import osName from 'os-name'
import defaultShell from 'default-shell'
import { readFile } from 'fs/promises'
import { join } from 'path'

const MAX_ITERATIONS = 20

export interface RunLoopInput {
  userText: string
  host: HostAdapter
  provider: LLMProvider
  history: Message[]
  settings: CaptainSettings
}

// 현재 실행 중인 루프 중단용
let abortController: AbortController | null = null

export function abortLoop() {
  abortController?.abort()
  abortController = null
}

/**
 * 에이전트 루프 실행.
 * - 중복 호출 방지는 caller(main.ts)의 state.busy에서 담당
 * - 타임아웃은 Provider 내부의 AbortSignal.timeout()에서 담당
 * - 이 함수는 절대 throw하지 않음 (에러는 host.emit으로 전달)
 */
export async function runLoop(input: RunLoopInput): Promise<void> {
  abortController = new AbortController()
  const signal = abortController.signal
  const { userText, host, provider } = input

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
    console.error('[Core Trace] Loop 3. Context fully assembled')

    const messages: Message[] = [
      {
        role: 'system',
        content: buildSystemPrompt({
          projectRoot: host.getProjectRoot(),
          openFiles,
          rules,
          os: osName(),
          shell: defaultShell,
          tools: toolRegistry.getToolDefinitions(),
          mode: host.getMode()
        })
      },
      ...input.history,
      { role: 'user', content: userText }
    ]

    truncateMessages(messages, input.settings.model.contextWindow)

    let iterations = 0

    while (iterations++ < MAX_ITERATIONS) {
      if (signal.aborted) break

      // LLM 스트리밍 호출 — 타임아웃은 Provider가 signal로 처리
      let response
      console.error('[Core Trace] Loop 4. Sending request to provider stream (iteration', iterations, ')')
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
        console.error('[Core Trace] Loop 5. Provider stream resolved successfully')
      } catch (e: any) {
        console.error('[Core Trace] Loop X. Provider stream threw:', e)
        // abort에 의한 중단은 정상 종료
        if (signal.aborted) break
        // 그 외 모든 에러 (타임아웃 포함) — UI에 표시 후 종료
        const message = e?.name === 'TimeoutError' || e?.message?.includes('timed out')
          ? `LLM 응답 타임아웃. Ollama가 실행 중인지 확인하세요.`
          : `LLM 오류: ${e?.message || '알 수 없는 오류'}`
        host.emit('error', { message, retryable: true })
        break
      }

      // 스트림 완료 알림
      host.emit('stream_end', {})

      if (!response.tool_calls?.length) break  // 도구 없음 → 완료

      messages.push(response)

      // 도구 실행
      for (const call of response.tool_calls) {
        if (signal.aborted) break
        host.emit('tool_start', { tool: call.function.name, args: call.function.arguments })
        try {
          const result = await toolRegistry.dispatch(call, host)
          host.emit('tool_result', { tool: call.function.name, result })
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) })
        } catch (e: any) {
          const errorResult = { error: e?.message || 'Tool execution failed' }
          host.emit('tool_result', { tool: call.function.name, result: errorResult })
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(errorResult) })
        }
      }

      if (signal.aborted) break

      truncateMessages(messages, input.settings.model.contextWindow)

      // 컨텍스트 사용량 UI 전달
      const usedTokens = messages.reduce((s, m) => s + estimateTokens(
        typeof m.content === 'string' ? m.content : JSON.stringify(m)
      ), 0)
      const maxTokens = input.settings.model.contextWindow
      host.emit('context_usage', {
        usedTokens, maxTokens,
        percentage: Math.round(usedTokens / maxTokens * 100)
      })
    }

    if (!signal.aborted && iterations >= MAX_ITERATIONS) {
      host.emit('error', { message: '최대 반복 횟수 초과 (20회)', retryable: false })
    }
  } catch (e: any) {
    // 컨텍스트 조립 등 루프 외부 에러
    host.emit('error', { message: `에이전트 오류: ${e?.message}`, retryable: false })
  }
}

/** 토큰 추정 (1 토큰 ≈ 4 글자 근사치). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/** 메시지 토큰 합이 contextWindow 80%를 초과하면 가장 오래된 메시지부터 제거. */
export function truncateMessages(messages: Message[], contextWindow: number): void {
  const maxTokens = Math.floor(contextWindow * 0.8)
  const totalTokens = () => messages.reduce((sum, m) => sum + estimateTokens(
    typeof m.content === 'string' ? m.content : JSON.stringify(m)
  ), 0)
  while (totalTokens() > maxTokens && messages.length > 2) {
    messages.splice(1, 1)
  }
}
