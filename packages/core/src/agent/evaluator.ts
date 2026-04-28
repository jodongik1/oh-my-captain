/**
 * Evaluator-Optimizer Pattern (생성/평가 분리).
 *
 * 환각 통제의 마지막 방어선. 메인 루프(생성자)는 코드 생성·도구 실행에 집중하고,
 * 별도의 가벼운 LLM 호출이 *평가자* 역할을 맡아 다음을 판단한다:
 *
 *   1. 지금 사용자 목표에 가까워지고 있는가?
 *   2. 지난 도구 결과가 의미 있는 진전을 만들었는가?
 *   3. 무한 탐색·반복·이탈이 일어나고 있지 않은가?
 *
 * 평가자가 "이탈" 또는 "진전 없음" 을 보고하면, 메인 루프에 강한 hint 를 주입해
 * 진로를 보정한다.
 *
 * 비용 대비 효과를 위해 **drift / cadence 기반으로 띄엄띄엄** 호출한다 (매 turn 호출 X).
 */

import type { LLMProvider, Message, ToolCall } from '../providers/types.js'
import { makeLogger } from '../utils/logger.js'
import { EVALUATOR_TUNING } from './tuning.js'

const log = makeLogger('evaluator.ts')

export type Verdict = 'on_track' | 'drift' | 'stuck' | 'done'

export interface EvalResult {
  verdict: Verdict
  rationale: string
  /** "drift"/"stuck" 일 때 다음 행동 추천 (선택). */
  suggestion?: string
}

export class Evaluator {
  private driftCount = 0
  private lastEvalIteration = 0

  /**
   * 평가가 필요한 시점인지 판단.
   * - cadence 마다 / write 도구 직후 / drift 의심 시
   */
  shouldEvaluate(opts: {
    iteration: number
    usedWriteTool: boolean
    consecutiveSameTool: boolean
  }): boolean {
    if (EVALUATOR_TUNING.cadence <= 0 && !EVALUATOR_TUNING.evalAfterWrite) return false
    if (EVALUATOR_TUNING.evalAfterWrite && opts.usedWriteTool) return true
    if (opts.consecutiveSameTool && opts.iteration - this.lastEvalIteration >= 2) return true
    if (
      EVALUATOR_TUNING.cadence > 0 &&
      opts.iteration - this.lastEvalIteration >= EVALUATOR_TUNING.cadence
    ) return true
    return false
  }

  async evaluate(input: {
    userGoal: string
    recent: Message[]
    iteration: number
    provider: LLMProvider
  }): Promise<EvalResult> {
    this.lastEvalIteration = input.iteration

    const transcript = renderRecent(input.recent)
    const prompt = `You are an evaluator judging an AI coding agent's recent trajectory.

USER GOAL:
${input.userGoal}

RECENT AGENT ACTIVITY (last few steps):
${transcript}

Decide ONE verdict:
  - on_track: clear progress toward the user's goal
  - drift   : exploring but veering away / repeating / over-analyzing
  - stuck   : same error or same tool failing repeatedly
  - done    : the goal looks achieved; agent should write the final answer now

Respond in this strict JSON format (no extra commentary):
{"verdict": "on_track|drift|stuck|done", "rationale": "<one sentence>", "suggestion": "<one short next-step recommendation, or empty>"}
`

    let raw: string
    try {
      raw = await input.provider.complete(prompt)
    } catch (e) {
      log.warn(`Evaluator 호출 실패 — on_track 으로 간주: ${(e as Error).message}`)
      return { verdict: 'on_track', rationale: 'evaluator unavailable' }
    }

    const parsed = safeParseVerdict(raw)
    if (!parsed) {
      log.warn(`Evaluator 응답 파싱 실패 — on_track 으로 간주. raw=${raw.slice(0, 200)}`)
      return { verdict: 'on_track', rationale: 'unparseable evaluator response' }
    }

    if (parsed.verdict === 'drift' || parsed.verdict === 'stuck') {
      this.driftCount++
    } else {
      this.driftCount = 0
    }

    return parsed
  }

  /** 누적 drift 가 임계값을 넘어 강제 종결 hint 를 주입해야 하는지. */
  shouldForceFinalize(): boolean {
    return this.driftCount >= EVALUATOR_TUNING.driftThreshold
  }

  /** Evaluator 결과를 LLM 에 주입할 system 메시지로 변환. */
  toHint(result: EvalResult, forceFinalize: boolean): Message | null {
    if (result.verdict === 'on_track') return null

    if (forceFinalize || result.verdict === 'done') {
      return {
        role: 'system',
        content: `[Evaluator] verdict=${result.verdict}. **다음 응답에서는 도구를 호출하지 말고**, 지금까지 파악한 내용으로 사용자에게 마무리 답변을 작성하세요.\n근거: ${result.rationale}${result.suggestion ? `\n권장: ${result.suggestion}` : ''}`,
      }
    }

    if (result.verdict === 'drift') {
      return {
        role: 'system',
        content: `[Evaluator] 진행 방향이 사용자 목표에서 벗어나고 있습니다.\n근거: ${result.rationale}\n권장 행동: ${result.suggestion ?? '관련 없는 분석을 멈추고 사용자 목표를 다시 정의해 답변/실행하세요.'}`,
      }
    }

    // stuck
    return {
      role: 'system',
      content: `[Evaluator] 동일 패턴에서 막혀 있습니다.\n근거: ${result.rationale}\n권장 행동: ${result.suggestion ?? '다른 도구·다른 접근으로 전환하거나, 막힌 지점을 사용자에게 보고하세요.'}`,
    }
  }
}

// ── 헬퍼 ─────────────────────────────────────────────────────

function renderRecent(messages: Message[]): string {
  // 마지막 ~6개 메시지만 평가에 사용
  const slice = messages.slice(-6)
  return slice.map((m, i) => {
    if (m.role === 'assistant' && m.tool_calls?.length) {
      const calls = m.tool_calls.map(tc => `${tc.function.name}(${truncate(JSON.stringify(tc.function.arguments), 120)})`).join(', ')
      const text = typeof m.content === 'string' && m.content ? ` text="${m.content.slice(0, 160)}"` : ''
      return `${i + 1}. [assistant] tool_calls=${calls}${text}`
    }
    if (m.role === 'tool') {
      return `${i + 1}. [tool_result] ${truncate(typeof m.content === 'string' ? m.content : JSON.stringify(m.content), 240)}`
    }
    if (m.role === 'system') {
      return `${i + 1}. [system_hint] ${truncate(typeof m.content === 'string' ? m.content : '', 200)}`
    }
    if (m.role === 'user') {
      return `${i + 1}. [user] ${truncate(typeof m.content === 'string' ? m.content : '', 200)}`
    }
    return ''
  }).filter(Boolean).join('\n')
}

function safeParseVerdict(raw: string): EvalResult | null {
  // 첫 { ... } 블록을 잡아낸다 — 모델이 앞뒤로 잡담을 붙일 수 있음
  const m = raw.match(/\{[\s\S]*?\}/)
  if (!m) return null
  try {
    const obj = JSON.parse(m[0]) as { verdict?: string; rationale?: string; suggestion?: string }
    const verdict = (obj.verdict ?? '').toLowerCase()
    if (!['on_track', 'drift', 'stuck', 'done'].includes(verdict)) return null
    return {
      verdict: verdict as Verdict,
      rationale: typeof obj.rationale === 'string' ? obj.rationale : '',
      suggestion: typeof obj.suggestion === 'string' && obj.suggestion ? obj.suggestion : undefined,
    }
  } catch {
    return null
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 3) + '...' : s
}

/** assistant 의 tool_calls 가 write 도구를 포함하는지 */
export function callsIncludeWrite(calls: ToolCall[] | undefined): boolean {
  if (!calls) return false
  return calls.some(c => c.function.name === 'write_file' || c.function.name === 'edit_file' || c.function.name === 'edit_symbol')
}
