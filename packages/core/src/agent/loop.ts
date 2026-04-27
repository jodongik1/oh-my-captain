import * as toolRegistry from '../tools/registry.js'
import { buildSystemPrompt } from './context.js'
import { compactMessages } from './compactor.js'
import { loadMemory, trimMemoryForContext } from './memory.js'
import { runAutoVerify, verifySignature, type VerifyResult } from './verifier.js'
import { estimateTokens, totalTokens } from '../utils/tokens.js'
import { makeLogger } from '../utils/logger.js'
import type { HostAdapter } from '../host/interface.js'
import type { LLMProvider, Message, ToolCall, ImageAttachment } from '../providers/types.js'
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

/**
 * 동일 도구 연속 호출 감지 — hint 주입 임계값.
 * (인자가 달라도) 같은 도구를 4회 이상 연속 호출하면 LLM 에 전략 변경 hint 주입.
 */
const SAME_TOOL_HINT_THRESHOLD = 4

/**
 * 동일 도구 연속 호출 감지 — 종결 유도 + 도구 차단 임계값.
 * 7회 이상이면 해당 도구를 disabledTools 에 추가하여 차단하고,
 * 강한 종결 hint 를 LLM 에 주입하여 마무리하도록 유도합니다.
 *
 * **hard break 는 하지 않습니다** — 사용자에게 결과 없이 종료되는 경험을 주지 않기 위함.
 * 진짜 안전망은 MAX_ITERATIONS=25.
 */
const SAME_TOOL_FINALIZE_THRESHOLD = 7

/** 코드 변경을 일으키는 도구 — 호출 시 turn 끝에 자동 verify 트리거 */
const WRITE_TOOLS = new Set(['write_file', 'edit_file', 'edit_symbol'])

/** 동일 verify 실패 시그니처가 이 횟수만큼 반복되면 강한 hint 주입 */
const VERIFY_HINT_THRESHOLD = 3
/** 동일 verify 실패가 이 횟수만큼 반복되면 사용자에게 알리고 루프 중단 */
const VERIFY_BREAK_THRESHOLD = 5

/**
 * 압축 체크 진입 임계값. 토큰 사용 비율이 이 값 미만이면 compactMessages() 를 건너뜁니다.
 * (TIER1_THRESHOLD=0.75 의 90% 인 0.675 — 안전 마진 포함)
 */
const COMPACTION_CHECK_RATIO = 0.675

/**
 * 광범위 분석 first-move 부스트를 트리거하는 키워드.
 * userText 에 이 중 하나라도 포함되면 첫 LLM 호출 직전에 일회성 system hint 가 주입됩니다.
 */
const BROAD_ANALYSIS_KEYWORDS = [
  '분석', '구조', '코드베이스', '전체', '워크스페이스', '프로젝트 파악',
  '아키텍처', '감사', '한눈에', '전반', '훑어',
  'analyze', 'analyse', 'codebase', 'workspace', 'overview', 'architecture', 'audit',
]

function detectBroadAnalysis(userText: string): boolean {
  const t = userText.toLowerCase()
  return BROAD_ANALYSIS_KEYWORDS.some(k => t.includes(k.toLowerCase()))
}

const FIRST_MOVE_HINT = `[System Hint] 광범위 분석 요청으로 감지되었습니다. 첫 응답에서 다음을 **단일 turn 안에 병렬로 호출**하세요:
1) glob_tool('**/*.{ts,tsx,js,kt,java,py,go,md}', maxResults=300)
2) run_terminal('find . -maxdepth 3 -type f \\( -name "package.json" -o -name "build.gradle*" -o -name "pom.xml" -o -name "Cargo.toml" -o -name "go.mod" -o -name "README*" -o -name "tsconfig*.json" \\) -not -path "*/node_modules/*" -not -path "*/.git/*"')
3) read_file 로 핵심 메타파일 3~5개 동시 읽기 (예: package.json, README.md, tsconfig.json)
list_dir 로 트리를 한 단계씩 내려가지 마세요.`

export interface RunLoopInput {
  userText: string
  host: HostAdapter
  provider: LLMProvider
  history: Message[]
  settings: CaptainSettings
  /** 사용자 메시지에 첨부된 이미지 (멀티모달 모델일 때만 의미 있음) */
  attachments?: ImageAttachment[]
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
      input.attachments && input.attachments.length > 0
        ? { role: 'user', content: userText, attachments: input.attachments }
        : { role: 'user', content: userText },
    ]

    // ── First-move 부스트: 광범위 분석 요청이면 일회성 hint 주입 ──
    if (detectBroadAnalysis(userText)) {
      log.debug('Broad analysis detected — injecting first-move hint')
      messages.push({ role: 'system', content: FIRST_MOVE_HINT })
    }

    let iterations = 0
    // 반복 에러 감지용 상태
    let lastToolError: string | null = null
    let consecutiveErrorCount = 0
    // 동일 도구 연속 호출 감지용 상태
    let lastToolName: string | null = null
    let consecutiveSameToolCount = 0
    // 직전 iteration 에서 도구 호출이 있었는지 (UI 의 thinking 노이즈 제어용)
    let prevIterationHadTools = false
    // 차단된 도구 (반복 호출로 인해 일시 비활성화) — 실제 실행 없이 자연어 안내 반환
    const disabledTools = new Set<string>()
    // verify 실패 반복 추적 (자가수정 루프 안전망)
    let lastVerifySignature: string | null = null
    let consecutiveVerifyFailures = 0

    while (iterations++ < MAX_ITERATIONS) {
      if (signal.aborted) break
      while (steeringQueue.length > 0) {
        const injected = steeringQueue.shift()!
        log.debug('Steering inject:', injected)
        messages.push({ role: 'user', content: `[User Steering] ${injected}` })
      }

      // ── 압축 체크 가드: 임계값에 가까울 때만 compactor 진입 ──
      const ctxWin = input.settings.model.contextWindow
      const beforeTokens = totalTokens(messages)
      if (beforeTokens / ctxWin >= COMPACTION_CHECK_RATIO) {
        const compacted = await compactMessages(messages, ctxWin, provider)
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
      }

      let response
      log.debug('Loop 4. Sending to provider (iteration', iterations, ')')
      // thinking_start payload: iteration 번호 + 직전 turn 이 도구 호출이었는지 표시.
      // Webview 에서 afterTool=true 인 짧은 thinking 은 숨길 수 있도록 신호 전달.
      host.emit('thinking_start', { iteration: iterations, afterTool: prevIterationHadTools })
      const thinkingStart = Date.now()
      let hasStartedStreaming = false
      let thinkingBuffer = ''  // extended thinking 으로 받은 사고 토큰을 누적

      host.emit('stream_start', { source: 'chat' })
      try {
        response = await provider.stream(
          messages,
          toolRegistry.getToolDefinitions(),
          (chunk) => {
            if (signal.aborted) return

            // 추론 모델의 사고 토큰은 별도로 누적만 하고 사용자 stream 으로는 노출하지 않음
            if (chunk.thinking) thinkingBuffer += chunk.thinking

            // 첫 번째 응답 토큰이 오면 '생각 중' 상태를 종료
            if (!hasStartedStreaming && chunk.token) {
              hasStartedStreaming = true
              host.emit('thinking_end', {
                durationMs: Date.now() - thinkingStart,
                content: thinkingBuffer || undefined,
              })
            }

            if (chunk.token) host.emit('stream_chunk', { token: chunk.token })
          },
          signal
        )
        // 스트림이 끝났는데 아직 thinking_end를 안 보냈다면 (토큰 없이 종료된 경우 등) 보냄
        if (!hasStartedStreaming) {
          host.emit('thinking_end', {
            durationMs: Date.now() - thinkingStart,
            content: thinkingBuffer || undefined,
          })
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

      // provider.stream 이 abort 신호에 즉시 반응하지 못하고 정상 종료한 경우에도
      // 여기서 한 번 더 차단해야 다음 iteration / dispatchTools 가 시작되지 않는다.
      if (signal.aborted) break

      if (typeof response.content === 'string' && response.content.length > 0) {
        finalContent = response.content
      }

      if (!response.tool_calls?.length) {
        prevIterationHadTools = false
        break
      }
      messages.push(response)

      // ── 반복 도구 감지 (트리 워킹 안티패턴 차단) ──
      const toolNames = response.tool_calls.map(c => c.function.name)
      const uniqueTools = new Set(toolNames)
      if (uniqueTools.size === 1) {
        const name = toolNames[0]
        if (name === lastToolName) {
          consecutiveSameToolCount += toolNames.length
        } else {
          lastToolName = name
          consecutiveSameToolCount = toolNames.length
        }
      } else {
        // 한 turn 에 서로 다른 도구가 섞여 있으면 정상 — 카운터 리셋
        lastToolName = null
        consecutiveSameToolCount = 0
      }

      // ── 종결 유도 + 도구 차단 (hard break 없음) ──
      // 7회 이상 동일 도구 연속 호출 시: 해당 도구 차단 + 강한 종결 hint 주입.
      // 사용자에게는 에러를 노출하지 않고, LLM 이 다음 응답에서 자연스럽게 마무리하도록 유도.
      if (lastToolName && consecutiveSameToolCount >= SAME_TOOL_FINALIZE_THRESHOLD && !disabledTools.has(lastToolName)) {
        disabledTools.add(lastToolName)
        const finalizeHint = `[System Hint] 도구 '${lastToolName}' 가 ${consecutiveSameToolCount}회 연속 호출되어 일시 차단되었습니다. 지금까지 수집된 정보로 충분합니다.

**다음 응답에서는 더 이상 도구를 호출하지 말고**, 지금까지 파악한 내용을 마크다운으로 정리(## 헤딩, **볼드**, 표, 리스트 사용)하여 사용자에게 답변을 작성하세요. 추가 정보가 정말 필요하다면 다른 도구(glob_tool, grep_tool, run_terminal)를 써야 합니다.`
        log.warn(`동일 도구 ${consecutiveSameToolCount}회 — 차단 + 종결 hint 주입 (tool=${lastToolName})`)
        messages.push({ role: 'system', content: finalizeHint })
      }
      // 부드러운 hint (4회) — LLM 이 자율적으로 전략 변경하도록 유도
      else if (lastToolName && consecutiveSameToolCount === SAME_TOOL_HINT_THRESHOLD) {
        const altSuggestion = lastToolName === 'list_dir'
          ? "glob_tool('**/*.{ts,tsx,kt,...}') 또는 run_terminal('find . -maxdepth 3 ...')"
          : lastToolName === 'read_file'
          ? 'grep_tool 로 위치 파악 후 startLine/endLine 으로 범위 제한'
          : '다른 도구(glob_tool/grep_tool/run_terminal)'
        const hint = `[System Hint] 같은 도구('${lastToolName}')를 ${consecutiveSameToolCount}회 연속 사용하고 있습니다. ${altSuggestion} 로 한 번에 더 많은 정보를 얻을 수 있는지 검토하거나, 정보가 충분하다면 즉시 답변을 작성하세요.`
        log.warn(`반복 도구 hint 주입: ${lastToolName} ${consecutiveSameToolCount}회`)
        messages.push({ role: 'system', content: hint })
      }

      if (signal.aborted) break
      await dispatchTools(response.tool_calls, messages, host, signal, disabledTools)

      prevIterationHadTools = true

      // ── 자동 검증 (Auto Verify) ──
      // 이번 turn 에 코드 변경 도구가 한 번이라도 사용되었으면 프로젝트 검증 실행.
      // 결과는 LLM 의 다음 turn 에서 system 메시지로 보임 → LLM 이 즉시 수정 시도.
      const wroteCode = response.tool_calls.some(c => WRITE_TOOLS.has(c.function.name))
      if (wroteCode && !signal.aborted) {
        const verify = await runWithVerifyEvents(host, signal)
        if (verify) {
          if (verify.passed) {
            log.info(`Auto Verify 통과: ${verify.command} (${verify.durationMs}ms)`)
            // 통과는 messages 에 굳이 넣지 않음 (노이즈 줄임). UI 만 신호.
            lastVerifySignature = null
            consecutiveVerifyFailures = 0
          } else {
            const sig = verifySignature(verify)
            if (sig === lastVerifySignature) {
              consecutiveVerifyFailures++
            } else {
              lastVerifySignature = sig
              consecutiveVerifyFailures = 1
            }
            log.warn(`Auto Verify 실패 [${consecutiveVerifyFailures}/${VERIFY_BREAK_THRESHOLD}]: ${verify.command} (exit ${verify.exitCode})`)

            const breakNow = consecutiveVerifyFailures >= VERIFY_BREAK_THRESHOLD
            const hint = breakNow
              ? `[Auto Verify] 동일한 빌드/검증 오류가 ${consecutiveVerifyFailures}회 반복되어 작업을 중단합니다. 사용자에게 현재까지의 진행과 막힌 지점을 보고하세요.`
              : consecutiveVerifyFailures >= VERIFY_HINT_THRESHOLD
                ? `[Auto Verify] 같은 오류가 ${consecutiveVerifyFailures}회 반복되고 있습니다. 다른 접근을 시도하세요 (관련 파일 다시 읽기, 의존성/임포트 확인, 시그니처 재검토). 막혀있다면 사용자에게 도움을 요청하세요.\n\n명령: ${verify.command}\n\n${verify.output}`
                : `[Auto Verify] '${verify.command}' 가 실패했습니다 (exit ${verify.exitCode}, ${verify.durationMs}ms).\n\n${verify.output}\n\n위 오류를 분석하고 코드를 수정하세요. 통과 전에는 작업이 완료되었다고 사용자에게 답하지 마세요.`

            messages.push({ role: 'system', content: hint })
            if (breakNow) {
              host.emit('error', {
                message: `자동 검증이 ${consecutiveVerifyFailures}회 연속 실패하여 작업을 중단합니다.`,
                retryable: true,
              })
              break
            }
          }
        }
      }

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
  signal: AbortSignal,
  disabledTools?: ReadonlySet<string>
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
      parallel.map(call => executeSingleTool(call, host, signal, disabledTools))
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
    const result = await executeSingleTool(call, host, signal, disabledTools)
    messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) })
  }
}

/**
 * Auto Verify 를 실행하면서 verify_start / verify_result IPC 이벤트를 emit 한다.
 * UI 가 status 표시줄 / timeline 에 진행과 결과를 보여줄 수 있게 함.
 */
async function runWithVerifyEvents(
  host: HostAdapter,
  signal: AbortSignal
): Promise<VerifyResult | null> {
  // 미리 명령 결정해서 emit 하기엔 detect 가 IO — 그냥 verifier 가 결정 후 결과만 받음.
  // verify 시작 시점은 "검증 중" 단일 라벨로 표시 (명령 라벨은 결과 시점에 emit).
  host.emit('verify_start', { command: 'auto', projectKind: '' })
  try {
    const result = await runAutoVerify(host.getProjectRoot(), signal)
    if (!result) {
      // 감지 실패 — 사용자에게는 표시하지 않음, 로그만.
      host.emit('verify_result', {
        command: '(skip)',
        projectKind: 'unknown',
        passed: true,
        exitCode: 0,
        output: '',
        durationMs: 0,
        timedOut: false,
      })
      return null
    }
    host.emit('verify_result', {
      command: result.command,
      projectKind: result.projectKind,
      passed: result.passed,
      exitCode: result.exitCode,
      output: result.output,
      durationMs: result.durationMs,
      timedOut: result.timedOut,
    })
    return result
  } catch (e) {
    log.error('runWithVerifyEvents 실패:', e)
    return null
  }
}

async function executeSingleTool(
  call: ToolCall,
  host: HostAdapter,
  signal: AbortSignal,
  disabledTools?: ReadonlySet<string>
): Promise<unknown> {
  if (signal.aborted) return { error: 'Aborted' }

  // 차단된 도구는 실제 실행 없이 자연어 안내로 tool_result 반환.
  // LLM 의 messages 에는 들어가지만 사용자에게는 에러가 아닌 "건너뜀" 으로 표시.
  if (disabledTools?.has(call.function.name)) {
    log.warn(`Tool '${call.function.name}' is disabled — silent skip`)
    const skippedResult = {
      __toolSkipped: true,
      reason: `'${call.function.name}' 가 너무 많이 호출되어 차단되었습니다. 지금까지 수집된 정보로 사용자에게 답변을 작성하세요. 추가 정보가 필요하면 다른 도구(glob_tool, grep_tool, run_terminal)를 사용하세요.`,
    }
    host.emit('tool_start', { tool: call.function.name, args: call.function.arguments })
    host.emit('tool_result', { tool: call.function.name, result: skippedResult })
    return skippedResult
  }

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


