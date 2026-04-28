/**
 * 5-Stage Context Compaction Pipeline.
 *
 * LLM 의 주의력을 보호하기 위해 매 모델 호출 직전에 적용되는 단계적 압축 전략.
 * 단계별로 점차 강하게 잘라내며, 이전 단계로 충분하면 다음 단계는 진입하지 않는다.
 *
 *   1. Budget reduction  — 정적 시스템 영역(rules/memory/open files)을 슬림화
 *   2. Snip              — 가장 오래된 대용량 tool_result 본문 삭제 (메타만 유지)
 *   3. Microcompact      — 남은 대용량 tool_result 본문을 head/tail 만 보존
 *   4. Context collapse  — 오래된 user/assistant 턴을 구조화 요약으로 대체 (룰 기반)
 *   5. Auto-compact      — 전체 히스토리를 LLM 요약으로 교체 (마지막 수단)
 *
 * 모든 단계는 system 메시지(0번)와 최근 PRESERVE_RECENT 개의 메시지를 절대 건드리지 않는다.
 */

import type { LLMProvider, Message } from '../providers/types.js'
import { totalTokens, estimateTokens } from '../utils/tokens.js'
import { makeLogger } from '../utils/logger.js'
import { COMPACTOR_TUNING, TOOL_RESULT_LIMITS } from './tuning.js'

const log = makeLogger('compactor.ts')

/** 모든 단계가 보존하는 최근 메시지 수 (현재 ReAct 흐름을 깨지 않기 위함) */
const PRESERVE_RECENT = 6

/** Snip / Microcompact 진입 시 이 값보다 큰 tool_result 만 대상이 된다. */
const TOOL_RESULT_LARGE_THRESHOLD_CHARS = 1500

export type CompactionStage =
  | 'none'
  | 'budget'
  | 'snip'
  | 'microcompact'
  | 'collapse'
  | 'auto'

export interface CompactionResult {
  messages: Message[]
  stage: CompactionStage
  beforeTokens: number
  afterTokens: number
}

/**
 * 메인 진입점. 현재 사용 비율을 보고 필요한 단계까지 적용한다.
 * 한 번의 호출에서 여러 단계를 누적 적용할 수 있다(누적 효과로 임계 이하로 떨어지면 거기서 종료).
 */
export async function compactMessages(
  messages: Message[],
  contextWindow: number,
  provider: LLMProvider
): Promise<CompactionResult> {
  const beforeTokens = totalTokens(messages)
  const ratio = beforeTokens / contextWindow

  if (ratio < COMPACTOR_TUNING.checkRatio) {
    return { messages, stage: 'none', beforeTokens, afterTokens: beforeTokens }
  }

  let current = messages
  let appliedStage: CompactionStage = 'none'

  // ── Stage 1: Budget reduction ─────────────────────────────────
  if (currentRatio(current, contextWindow) >= COMPACTOR_TUNING.budgetReduction) {
    current = stage1BudgetReduction(current)
    appliedStage = 'budget'
    if (currentRatio(current, contextWindow) < COMPACTOR_TUNING.snip) {
      return finalize('budget', messages, current, beforeTokens)
    }
  }

  // ── Stage 2: Snip ─────────────────────────────────────────────
  if (currentRatio(current, contextWindow) >= COMPACTOR_TUNING.snip) {
    current = stage2Snip(current)
    appliedStage = 'snip'
    if (currentRatio(current, contextWindow) < COMPACTOR_TUNING.microcompact) {
      return finalize('snip', messages, current, beforeTokens)
    }
  }

  // ── Stage 3: Microcompact ─────────────────────────────────────
  if (currentRatio(current, contextWindow) >= COMPACTOR_TUNING.microcompact) {
    current = stage3Microcompact(current)
    appliedStage = 'microcompact'
    if (currentRatio(current, contextWindow) < COMPACTOR_TUNING.contextCollapse) {
      return finalize('microcompact', messages, current, beforeTokens)
    }
  }

  // ── Stage 4: Context collapse (rule-based, no LLM) ───────────
  if (currentRatio(current, contextWindow) >= COMPACTOR_TUNING.contextCollapse) {
    current = stage4ContextCollapse(current)
    appliedStage = 'collapse'
    if (currentRatio(current, contextWindow) < COMPACTOR_TUNING.autoCompact) {
      return finalize('collapse', messages, current, beforeTokens)
    }
  }

  // ── Stage 5: Auto-compact (LLM summarization, last resort) ───
  try {
    current = await stage5AutoCompact(current, provider)
    appliedStage = 'auto'
  } catch (e) {
    log.warn(`Auto-compact 실패 — collapse 결과 유지: ${(e as Error).message}`)
    // collapse 결과로 진행
  }

  return finalize(appliedStage, messages, current, beforeTokens)
}

function finalize(
  stage: CompactionStage,
  before: Message[],
  after: Message[],
  beforeTokens: number
): CompactionResult {
  const afterTokens = totalTokens(after)
  log.info(`Compaction[${stage}]: ${beforeTokens} → ${afterTokens} tokens (${before.length} → ${after.length} msgs)`)
  return { messages: after, stage, beforeTokens, afterTokens }
}

function currentRatio(messages: Message[], ctxWindow: number): number {
  return totalTokens(messages) / ctxWindow
}

// ── Stage 1: Budget reduction ─────────────────────────────────
/**
 * 시스템 프롬프트 안의 정적 섹션 (Project Rules, Memory, Open Files) 을 슬림화한다.
 * 이 섹션들은 매 turn 동일하게 반복되어 컨텍스트 비효율의 큰 원인이다.
 */
function stage1BudgetReduction(messages: Message[]): Message[] {
  if (messages.length === 0 || messages[0].role !== 'system') return messages

  const sys = messages[0].content
  let trimmed = sys

  // Open Files 섹션의 심볼 리스트만 축소 (파일 경로는 보존)
  trimmed = trimmed.replace(
    /(## 현재 열려 있는 파일\n\n)([\s\S]*?)(?=\n## |\n\n\{|$)/,
    (_, header, body) => {
      const slim = body
        .split('\n')
        .filter((line: string) => !line.startsWith('  - ')) // 심볼 디테일 제거
        .join('\n')
      return `${header}${slim}`
    }
  )

  // Project Memory 섹션이 8000자를 넘으면 앞 4000자만 유지
  trimmed = trimmed.replace(
    /(## Project Memory\n\n[\s\S]*?\n\n)([\s\S]+?)(?=\n## |$)/,
    (_, header, body) => {
      if (body.length <= 4000) return `${header}${body}`
      return `${header}${body.slice(0, 4000)}\n\n...(이전 메모리 일부 생략 — 컨텍스트 절약)...`
    }
  )

  if (trimmed === sys) return messages
  return [{ ...messages[0], content: trimmed } as Message, ...messages.slice(1)]
}

// ── Stage 2: Snip ─────────────────────────────────────────────
/**
 * 오래된 대용량 tool_result 의 본문을 메타데이터(도구 이름·길이)만 남기고 제거한다.
 * 같은 정보를 LLM 이 또 보고 있을 가능성이 높고, 버려도 흐름이 깨지지 않는 부분.
 */
function stage2Snip(messages: Message[]): Message[] {
  const cutoff = Math.max(1, messages.length - PRESERVE_RECENT)
  return messages.map((msg, i) => {
    if (i === 0 || i >= cutoff) return msg
    if (msg.role !== 'tool') return msg
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
    if (content.length <= TOOL_RESULT_LARGE_THRESHOLD_CHARS) return msg
    const toolHint = extractToolName(content)
    return {
      ...msg,
      content: JSON.stringify({
        __snipped: true,
        tool: toolHint,
        originalChars: content.length,
        note: 'Older tool result was truncated to save context. Re-run the tool if you need this data again.',
      }),
    }
  })
}

// ── Stage 3: Microcompact ─────────────────────────────────────
/**
 * 남아 있는 모든 대용량 tool_result 를 head/tail 만 보존하는 형태로 압축한다.
 */
function stage3Microcompact(messages: Message[]): Message[] {
  const cutoff = Math.max(1, messages.length - PRESERVE_RECENT)
  const HEAD = TOOL_RESULT_LIMITS.microcompactHead
  const TAIL = TOOL_RESULT_LIMITS.microcompactTail
  return messages.map((msg, i) => {
    if (i === 0 || i >= cutoff) return msg
    if (msg.role !== 'tool') return msg
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
    if (content.length <= HEAD + TAIL + 200) return msg
    const head = content.slice(0, HEAD)
    const tail = content.slice(-TAIL)
    return {
      ...msg,
      content: `${head}\n\n...(${content.length - HEAD - TAIL}자 생략)...\n\n${tail}`,
    }
  })
}

// ── Stage 4: Context collapse ─────────────────────────────────
/**
 * 시스템 프롬프트와 최근 N개를 제외한 모든 user/assistant 턴을 룰 기반 요약으로 대체한다.
 * LLM 호출 없이 즉시 수행 가능 (assistant 의 tool_calls 시그니처를 추출).
 */
function stage4ContextCollapse(messages: Message[]): Message[] {
  if (messages.length <= PRESERVE_RECENT + 2) return messages
  const system = messages[0]
  const preserved = messages.slice(-PRESERVE_RECENT)
  const middle = messages.slice(1, -PRESERVE_RECENT)

  const userTurns: string[] = []
  const toolUseSummary = new Map<string, number>()
  let assistantTextSamples = 0
  for (const m of middle) {
    if (m.role === 'user') {
      const txt = typeof m.content === 'string' ? m.content : ''
      if (txt) userTurns.push(txt.slice(0, 200))
    } else if (m.role === 'assistant') {
      if (m.tool_calls) {
        for (const tc of m.tool_calls) {
          toolUseSummary.set(tc.function.name, (toolUseSummary.get(tc.function.name) ?? 0) + 1)
        }
      }
      if (assistantTextSamples < 2 && typeof m.content === 'string' && m.content.length > 50) {
        assistantTextSamples++
      }
    }
  }

  const toolLine = Array.from(toolUseSummary.entries())
    .map(([name, count]) => `${name}×${count}`)
    .join(', ')

  const summaryBody = [
    `[Context Collapse — ${middle.length}개 메시지 압축]`,
    userTurns.length > 0
      ? `이전 사용자 발화: ${userTurns.map(s => `"${s.replace(/\s+/g, ' ')}"`).join(' / ')}`
      : null,
    toolLine ? `이전 도구 사용 카운트: ${toolLine}` : null,
    `참고: 자세한 도구 결과는 제거되었습니다. 필요하면 도구를 재실행하세요.`,
  ].filter(Boolean).join('\n')

  return [system, { role: 'system' as const, content: summaryBody }, ...preserved]
}

// ── Stage 5: Auto-compact (LLM summarization) ─────────────────
async function stage5AutoCompact(messages: Message[], provider: LLMProvider): Promise<Message[]> {
  if (messages.length <= PRESERVE_RECENT + 2) return messages
  const system = messages[0]
  const preserved = messages.slice(-PRESERVE_RECENT)
  const middle = messages.slice(1, -PRESERVE_RECENT)

  const transcript = middle.map(m => {
    const role = m.role.toUpperCase()
    if (m.role === 'assistant' && m.tool_calls?.length) {
      const calls = m.tool_calls.map(tc => `${tc.function.name}(${truncateArgs(tc.function.arguments)})`).join(', ')
      const text = m.content ? ` text="${m.content.slice(0, 200)}"` : ''
      return `[${role}] tool_calls=${calls}${text}`
    }
    const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
    return `[${role}] ${c.slice(0, 400)}`
  }).join('\n---\n')

  const prompt = `You are compressing prior turns of an AI coding agent so that the agent can keep working without losing essential progress.

Output a compact summary in the same language as the conversation. Preserve:
- The user's overall goal and any constraints they stated
- Files/functions modified so far and the rationale
- Outstanding TODOs / unresolved errors / blockers
- Important findings from tool results (concrete file paths, key code patterns)

Drop:
- Verbose tool output bodies (only mention what was learned)
- Polite filler, restated questions, redundant analysis

Be terse but lossless on facts. ~300-500 words max.

Conversation:
${transcript}

Compressed summary:`

  const summary = await provider.complete(prompt)

  return [
    system,
    {
      role: 'system' as const,
      content: `[이전 대화 요약 — auto-compact, ${middle.length}개 메시지]\n\n${summary.trim()}`,
    },
    ...preserved,
  ]
}

// ── 헬퍼 ──────────────────────────────────────────────────────
function extractToolName(content: string): string {
  // tool_result 의 content 가 JSON 이면 'tool' 키, 아니면 첫 줄에서 추측
  try {
    const parsed = JSON.parse(content) as { tool?: string }
    if (parsed?.tool) return parsed.tool
  } catch { /* not json */ }
  const firstLine = content.split('\n', 1)[0]
  return firstLine.length > 40 ? 'unknown' : firstLine
}

function truncateArgs(args: Record<string, unknown>): string {
  const s = JSON.stringify(args)
  return s.length > 120 ? s.slice(0, 117) + '...' : s
}

// 외부에서 토큰 추정 헬퍼를 가져갈 수 있도록 재노출
export { estimateTokens }
