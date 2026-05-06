/**
 * ReAct Agent Loop — Reason · Act · Observe.
 *
 * 단일 루프 안에서 LLM 의 사고/행동/관찰을 명시적으로 분리해 환각을 통제한다.
 * 설계 철학: "가능한 가장 단순한 해결책에서 시작하고, 필요할 때만 복잡성을 더하라."
 *
 * 매 iteration:
 *   1. Reason  — 컨텍스트 압축 → 모델 호출 (thinking 강제) → assistant 메시지 수신
 *   2. Act     — pre-flight 검증 → 도구 dispatch (병렬/직렬)
 *   3. Observe — 환경 측정 + 검증/에러 감지 → 다음 reasoning 에 system hint 주입
 *   4. Evaluate (optional) — 별도 평가자 호출로 진행 방향 점검
 *
 * 종료 조건:
 *   - 모델이 도구 없이 텍스트만 응답 (자연 종료)
 *   - 사용자 abort
 *   - max iterations 초과 (안전망)
 *   - 동일 에러 N회 연속 (조기 중단)
 *   - Auto Verify N회 실패 (조기 중단)
 *   - Evaluator 가 done/drift 한계 도달 (강제 마무리)
 */

import * as toolRegistry from '../tools/registry.js'
import { buildSystemPrompt } from './context.js'
import { compactMessages } from './compactor.js'
import { loadMemory, trimMemoryForContext } from './memory.js'
import { detectProjectStack } from './project_stack.js'
import { totalTokens, estimateTokens } from '../utils/tokens.js'
import { makeLogger } from '../utils/logger.js'
import { LoopController } from './loop/controller.js'
import { RepeatToolDetector } from './loop/repeat_detector.js'
import { ToolErrorDetector } from './loop/error_detector.js'
import { VerifyRunner } from './loop/verify_runner.js'
import { validateToolCalls, formatValidationFailure } from './validator.js'
import { observeToolResults } from './observer.js'
import { Evaluator, callsIncludeWrite } from './evaluator.js'
import { LOOP_TUNING } from './tuning.js'
import type { HostAdapter } from '../host/interface.js'
import type { LLMProvider, Message, ToolCall, ProviderImageInput } from '../providers/types.js'
import type { CaptainSettings } from '../settings/types.js'
import osName from 'os-name'
import defaultShell from 'default-shell'
import { readFile } from 'fs/promises'
import { join } from 'path'

const log = makeLogger('loop.ts')

const WRITE_TOOLS = new Set(['write_file', 'edit_file', 'edit_symbol'])

export interface RunLoopInput {
  userText: string
  host: HostAdapter
  provider: LLMProvider
  history: Message[]
  settings: CaptainSettings
  controller: LoopController
  attachments?: ProviderImageInput[]
}

/**
 * 한 턴이 끝난 뒤 DB 에 그대로 적재될 영속화용 메시지 시퀀스.
 * 라이브 타임라인 복원에 필요한 메타(thinking, tool_calls, tool_call_id) 를 함께 들고 있다.
 *
 * - assistant : LLM 응답 1건 = 한 row (thinking 메타 + tool_calls 포함)
 * - tool      : 도구 결과 1건 = 한 row (toolCallId/toolName 으로 호출자에 매칭)
 *
 * 운영용 messages[] 와는 독립 — 압축/관찰/평가용 system/user 힌트는 영속화 대상이 아니다.
 */
export interface PersistedTurnEntry {
  role: 'assistant' | 'tool'
  content: string
  thinking?: string
  thinkingDurationMs?: number
  toolCalls?: { id: string; name: string; args: unknown }[]
  toolCallId?: string
  toolName?: string
}

export interface RunLoopResult {
  finalContent: string | null
  conversationTurns: Message[]
  /** 이번 턴에 발생한 어시스턴트/도구 이벤트의 순서대로 정렬된 영속화 시퀀스. */
  persistedTurn: PersistedTurnEntry[]
}

export async function runLoop(input: RunLoopInput): Promise<RunLoopResult> {
  const signal = input.controller.start()
  const { userText, host, provider } = input

  let finalContent: string | null = null
  const persistedTurn: PersistedTurnEntry[] = []

  try {
    const messages = await assembleInitialMessages(input, userText)

    const repeatDetector = new RepeatToolDetector()
    const errorDetector = new ToolErrorDetector()
    const verifyRunner = new VerifyRunner()
    const evaluator = new Evaluator()

    let iteration = 0
    let prevHadTools = false
    let stopReason: 'natural' | 'aborted' | 'max_iter' | 'errors' | 'verify' | 'evaluator' = 'natural'

    while (iteration++ < LOOP_TUNING.maxIterations) {
      if (signal.aborted) { stopReason = 'aborted'; break }

      // ────────────────────────────────────────────────────
      //  Phase 1: REASON
      //   - 컨텍스트 압축 (5-stage pipeline)
      //   - 모델 호출 (thinking + tool_calls)
      // ────────────────────────────────────────────────────
      await maybeCompact(messages, input.settings.model.contextWindow, provider, host)

      const response = await callProvider(
        provider, messages, host, signal, prevHadTools, iteration
      )
      if (response === 'aborted') { stopReason = 'aborted'; break }
      if (response === 'error') break

      if (typeof response.content === 'string' && response.content.length > 0) {
        finalContent = response.content
      }

      // 영속화 시퀀스에 어시스턴트 응답 1행 적재 (thinking + tool_calls 메타 동봉).
      const thinkingMeta = response.__thinking
      const thinkingDur = response.__thinkingDurationMs ?? 0
      persistedTurn.push({
        role: 'assistant',
        content: response.content ?? '',
        ...(thinkingMeta ? { thinking: thinkingMeta } : {}),
        ...(thinkingDur > 0 ? { thinkingDurationMs: thinkingDur } : {}),
        ...(response.tool_calls?.length
          ? {
              toolCalls: response.tool_calls.map(tc => ({
                id: tc.id,
                name: tc.function.name,
                args: tc.function.arguments,
              })),
            }
          : {}),
      })

      // 도구 호출이 없으면 자연 종료 (LLM 의 최종 답변)
      if (!response.tool_calls?.length) {
        prevHadTools = false
        break
      }

      // sidecar 메타는 messages[] 에 누적시키지 않는다 (provider 가 다시 보면 안 됨).
      const { __thinking: _t, __thinkingDurationMs: _d, ...assistantClean } = response
      messages.push(assistantClean)

      // ────────────────────────────────────────────────────
      //  Phase 2: ACT
      //   - 반복 도구 감지 → 차단/hint
      //   - pre-flight 인자 검증
      //   - 도구 dispatch (병렬/직렬)
      // ────────────────────────────────────────────────────
      const repeatObs = repeatDetector.observe(response.tool_calls)
      messages.push(...repeatObs.hints)

      if (signal.aborted) { stopReason = 'aborted'; break }

      const dispatchResults = await dispatchValidatedTools(
        response.tool_calls,
        messages,
        host,
        signal,
        repeatDetector.disabledTools
      )
      prevHadTools = true

      // 도구 결과를 영속화 시퀀스에 적재 — 호출 순서대로, tool_call_id 와 함께.
      for (const r of dispatchResults) {
        persistedTurn.push({
          role: 'tool',
          content: typeof r.result === 'string' ? r.result : JSON.stringify(r.result),
          toolCallId: r.call.id,
          toolName: r.call.function.name,
        })
      }

      if (signal.aborted) { stopReason = 'aborted'; break }

      // ────────────────────────────────────────────────────
      //  Phase 3: OBSERVE
      //   - 환경 측정 (파일 존재·exit code·빈 결과 등)
      //   - 자동 검증 실행 (write 도구 사용 시)
      //   - 에러 반복 감지
      // ────────────────────────────────────────────────────
      const observation = await observeToolResults(dispatchResults, host)
      if (observation) messages.push(observation)

      const wroteCode = response.tool_calls.some(c => WRITE_TOOLS.has(c.function.name))
      if (wroteCode && !signal.aborted) {
        const verify = await verifyRunner.run(host, signal)
        if (verify.hint) messages.push(verify.hint)
        if (verify.shouldBreak) {
          host.emit('error', { message: verify.userMessage!, retryable: true })
          stopReason = 'verify'
          break
        }
      }

      // 사용자 거절 → 즉시 종료
      const latestToolMsgs = messages.filter(m => m.role === 'tool').slice(-response.tool_calls.length)
      if (latestToolMsgs.some(isUserRejected)) break

      const errObs = errorDetector.observe(latestToolMsgs)
      if (errObs.shouldBreak) {
        host.emit('error', { message: errObs.userMessage!, retryable: true })
        stopReason = 'errors'
        break
      }

      // ────────────────────────────────────────────────────
      //  Phase 4: EVALUATE (optional, sparse)
      //   - 진행 방향 점검 → drift/done 판정 시 강제 hint
      // ────────────────────────────────────────────────────
      if (evaluator.shouldEvaluate({
        iteration,
        usedWriteTool: callsIncludeWrite(response.tool_calls),
        consecutiveSameTool: repeatObs.consecutiveSameTool,
      })) {
        const evalResult = await evaluator.evaluate({
          userGoal: userText,
          recent: messages,
          iteration,
          provider,
        })
        const force = evaluator.shouldForceFinalize() || evalResult.verdict === 'done'
        const hint = evaluator.toHint(evalResult, force)
        if (hint) messages.push(hint)
        host.emit('eval_result', {
          verdict: evalResult.verdict,
          rationale: evalResult.rationale,
          suggestion: evalResult.suggestion,
          iteration,
        })
        if (force) {
          log.warn(`Evaluator 강제 마무리 — verdict=${evalResult.verdict}`)
          // 다음 reasoning 단계에서 모델이 도구 없이 응답하도록 유도. break 하지 않음.
        }
      }

      // 컨텍스트 사용량 보고
      const usedTokens = totalTokens(messages)
      const maxTokens = input.settings.model.contextWindow
      host.emit('context_usage', {
        usedTokens,
        maxTokens,
        percentage: Math.round((usedTokens / maxTokens) * 100),
      })
    }

    if (iteration > LOOP_TUNING.maxIterations) {
      stopReason = 'max_iter'
      log.warn(`maxIterations(${LOOP_TUNING.maxIterations}) 초과 — 강제 종료`)
      host.emit('error', {
        message: `에이전트가 ${LOOP_TUNING.maxIterations}회 안에 작업을 마치지 못해 중단합니다.`,
        retryable: true,
      })
    }

    log.debug(`Loop 종료 — reason=${stopReason}, iterations=${iteration - 1}`)
    return { finalContent, conversationTurns: messages.slice(1), persistedTurn }
  } catch (e) {
    host.emit('error', { message: `에이전트 오류: ${(e as Error)?.message}`, retryable: false })
    return { finalContent, conversationTurns: [], persistedTurn }
  }
}

// ── Phase 헬퍼 ────────────────────────────────────────────────

async function assembleInitialMessages(input: RunLoopInput, userText: string): Promise<Message[]> {
  const { host } = input
  const openFiles = await host.getOpenFiles().catch((e) => {
    log.error('host.getOpenFiles error:', e)
    return []
  })

  const rulesPath = join(host.getProjectRoot(), '.captain', 'rules.md')
  const rules = await readFile(rulesPath, 'utf-8').catch(() => '')

  const rawMemory = await loadMemory(host.getProjectRoot())
  const memory = trimMemoryForContext(rawMemory, 8000)

  // 프로젝트 스택 자동 감지 — manifest 스캔만 하므로 토큰 비용 0, 100% 결정적.
  const projectStack = await detectProjectStack(host.getProjectRoot()).catch((e) => {
    log.warn(`detectProjectStack 실패 — 스택 섹션 없이 진행 (${(e as Error).message})`)
    return ''
  })

  const messages: Message[] = [
    {
      role: 'system',
      content: await buildSystemPrompt({
        projectRoot: host.getProjectRoot(),
        openFiles,
        rules,
        memory,
        projectStack,
        os: osName(),
        shell: defaultShell,
        tools: toolRegistry.getToolDefinitions(),
        mode: host.getMode(),
      }),
    },
    ...input.history,
    input.attachments && input.attachments.length > 0
      ? { role: 'user', content: userText, attachments: input.attachments }
      : { role: 'user', content: userText },
  ]

  return messages
}

async function maybeCompact(
  messages: Message[],
  ctxWin: number,
  provider: LLMProvider,
  host: HostAdapter
): Promise<void> {
  const result = await compactMessages(messages, ctxWin, provider)
  if (result.stage !== 'none') {
    host.emit('compaction', {
      stage: result.stage,
      beforeTokens: result.beforeTokens,
      afterTokens: result.afterTokens,
    })
    messages.length = 0
    messages.push(...result.messages)
  }
}

async function callProvider(
  provider: LLMProvider,
  messages: Message[],
  host: HostAdapter,
  signal: AbortSignal,
  prevHadTools: boolean,
  iteration: number
): Promise<
  | { role: 'assistant'; content: string; tool_calls?: ToolCall[]; __thinking?: string; __thinkingDurationMs?: number }
  | 'aborted'
  | 'error'
> {
  host.emit('thinking_start', { iteration, afterTool: prevHadTools })
  const thinkingStart = Date.now()
  let hasStartedStreaming = false
  let thinkingBuffer = ''
  let bodyTokenChars = 0

  host.emit('stream_start', { source: 'chat' })
  let response
  try {
    response = await provider.stream(
      messages,
      toolRegistry.getToolDefinitions(),
      (chunk) => {
        if (signal.aborted) return
        if (chunk.thinking) thinkingBuffer += chunk.thinking
        if (!hasStartedStreaming && chunk.token) {
          hasStartedStreaming = true
          host.emit('thinking_end', {
            durationMs: Date.now() - thinkingStart,
            content: thinkingBuffer || undefined,
          })
        }
        if (chunk.token) {
          bodyTokenChars += chunk.token.length
          host.emit('stream_chunk', { token: chunk.token })
        }
      },
      signal
    )
    if (!hasStartedStreaming) {
      host.emit('thinking_end', {
        durationMs: Date.now() - thinkingStart,
        content: thinkingBuffer || undefined,
      })
    }

    // 빈 말풍선 폴백: provider 가 sanitizeContent 의 thinking → content 승격을 했지만
    // UI 는 본문 토큰을 한 번도 받지 못한 케이스. response.content 에 의미있는 길이가 있으면 1회 emit.
    // 임계값(4)은 stream_processor.ts 의 fallbackToThinkingIfEmpty 와 일치시켜 둘이 함께 트리거되거나 함께 잠잠하도록 한다.
    if (bodyTokenChars === 0 && typeof response.content === 'string' && response.content.trim().length > 4) {
      log.info(`UI 빈 말풍선 폴백 — 최종 본문(${response.content.length}자) 1회 forward`)
      host.emit('stream_chunk', { token: response.content })
    }
  } catch (e) {
    if (signal.aborted) {
      host.emit('stream_end', {})
      return 'aborted'
    }
    const err = e as { name?: string; message?: string }
    const message = err?.name === 'TimeoutError' || err?.message?.includes('timed out')
      ? `LLM 응답 타임아웃. Ollama가 실행 중인지 확인하세요.`
      : `LLM 오류: ${err?.message || '알 수 없는 오류'}`
    host.emit('error', { message, retryable: true })
    host.emit('stream_end', {})
    return 'error'
  }

  host.emit('stream_end', {})
  if (signal.aborted) return 'aborted'
  // thinking 메타를 sidecar 필드로 동봉 — 영속화 시 chat.ts 가 사용. 모델 메시지에는 사용하지 않으므로
  // 호출 직후 분리하여 messages 에 push 할 때 제거한다 (provider 가 다시 보면 안 됨).
  const thinkingDurationMs = Date.now() - thinkingStart
  return { ...response, __thinking: thinkingBuffer || undefined, __thinkingDurationMs: thinkingDurationMs }
}

/**
 * pre-flight 검증과 도구 dispatch 를 합친 헬퍼.
 *
 * 검증 통과한 호출만 실제 dispatch 하고, 실패한 호출에는 검증 에러를 tool_result 로 즉시 push.
 * 실행 결과(observer 가 분석할 수 있는 형식)를 모아 반환한다.
 */
async function dispatchValidatedTools(
  calls: ToolCall[],
  messages: Message[],
  host: HostAdapter,
  signal: AbortSignal,
  disabledTools: ReadonlySet<string>
): Promise<{ call: ToolCall; result: unknown }[]> {
  const validated = validateToolCalls(calls)
  const results: { call: ToolCall; result: unknown }[] = []

  // 1. 검증 실패 호출은 즉시 tool_result 로 피드백 (실제 dispatch X)
  const survivors: ToolCall[] = []
  for (const v of validated) {
    if (!v.outcome.ok) {
      const failResult = formatValidationFailure(v.outcome)
      messages.push({ role: 'tool', tool_call_id: v.call.id, content: failResult })
      host.emit('tool_start', { tool: v.call.function.name, args: v.call.function.arguments })
      host.emit('tool_result', { tool: v.call.function.name, result: JSON.parse(failResult) })
      results.push({ call: v.call, result: JSON.parse(failResult) })
    } else {
      survivors.push(v.call)
    }
  }

  if (survivors.length === 0) return results

  // 2. 통과한 호출들만 병렬/직렬 분리해 실행
  const parallel: ToolCall[] = []
  const serial: ToolCall[] = []
  for (const call of survivors) {
    const def = toolRegistry.getToolDef(call.function.name)
    if (def?.concurrencySafe) parallel.push(call)
    else serial.push(call)
  }

  if (parallel.length > 0) {
    const settled = await Promise.allSettled(
      parallel.map(call => executeSingle(call, host, signal, disabledTools))
    )
    for (let i = 0; i < parallel.length; i++) {
      const call = parallel[i]
      const settledI = settled[i]
      const result = settledI.status === 'fulfilled'
        ? settledI.value
        : { error: (settledI.reason as Error)?.message || 'Tool execution failed' }
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) })
      results.push({ call, result })
    }
  }
  for (const call of serial) {
    if (signal.aborted) break
    const result = await executeSingle(call, host, signal, disabledTools)
    messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) })
    results.push({ call, result })
  }

  return results
}

async function executeSingle(
  call: ToolCall,
  host: HostAdapter,
  signal: AbortSignal,
  disabledTools: ReadonlySet<string>
): Promise<unknown> {
  if (signal.aborted) return { error: 'Aborted' }

  if (disabledTools.has(call.function.name)) {
    log.warn(`Tool '${call.function.name}' 차단됨 — silent skip`)
    const skipped = {
      __toolSkipped: true,
      reason: `'${call.function.name}' 가 너무 많이 호출되어 차단되었습니다. 지금까지 수집된 정보로 답변을 작성하세요.`,
    }
    host.emit('tool_start', { tool: call.function.name, args: call.function.arguments })
    host.emit('tool_result', { tool: call.function.name, result: skipped })
    return skipped
  }

  host.emit('tool_start', { tool: call.function.name, args: call.function.arguments })
  try {
    const result = await toolRegistry.dispatch(call, host, signal)
    host.emit('tool_result', { tool: call.function.name, result })
    return result
  } catch (e) {
    const errorResult = { error: (e as Error)?.message || 'Tool execution failed' }
    host.emit('tool_result', { tool: call.function.name, result: errorResult })
    return errorResult
  }
}

function isUserRejected(m: Message): boolean {
  if (m.role !== 'tool') return false
  try {
    const parsed = JSON.parse(m.content) as { __userRejected?: boolean }
    return parsed?.__userRejected === true
  } catch {
    return false
  }
}

export { estimateTokens }
