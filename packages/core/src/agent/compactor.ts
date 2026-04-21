/**
 * 3-Tier Context Compaction Strategy.
 *
 * Tier 1 — Tool Output Trimming (75% 초과)
 *   오래된 tool result 메시지의 content를 요약/축소.
 *   대화 흐름(user/assistant)은 보존.
 *
 * Tier 2 — LLM Summarization (85% 초과)
 *   오래된 대화 턴을 LLM으로 요약, 단일 system 메시지로 교체.
 *   System(0번) + 요약 + 최근 N개 메시지 보존.
 *
 * Tier 3 — Hard Reset (95% 초과)
 *   LLM 요약 실패 시 또는 극한 상황.
 *   System + 마지막 3개 메시지만 유지.
 */

import type { LLMProvider, Message } from '../providers/types.js'
import { totalTokens } from '../utils/tokens.js'
import { makeLogger } from '../utils/logger.js'

const log = makeLogger('compactor.ts')

// ── 임계값 (contextWindow 대비 비율) ──
const TIER1_THRESHOLD = 0.75
const TIER2_THRESHOLD = 0.85
const TIER3_THRESHOLD = 0.95

// 도구 결과 축소 시 최대 길이
const TOOL_RESULT_MAX_CHARS = 2000
// Tier 2 요약 시 보존할 최근 메시지 수
const PRESERVE_RECENT = 5



/**
 * Tier 1: 오래된 tool result 메시지의 대용량 출력을 축소합니다.
 * - 최근 PRESERVE_RECENT개를 제외한 tool 메시지 대상
 * - 긴 content를 앞/뒤만 보존하고 중간 생략
 */
function tier1TrimToolOutputs(messages: Message[]): Message[] {
  const cutoff = Math.max(1, messages.length - PRESERVE_RECENT)

  return messages.map((msg, i) => {
    // 최근 메시지 또는 system은 건드리지 않음
    if (i === 0 || i >= cutoff) return msg
    if (msg.role !== 'tool') return msg

    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
    if (content.length <= TOOL_RESULT_MAX_CHARS) return msg

    // 앞 800자 + ... + 뒤 800자
    const head = content.slice(0, 800)
    const tail = content.slice(-800)
    return {
      ...msg,
      content: `${head}\n\n...(${content.length - 1600}자 생략)...\n\n${tail}`,
    }
  })
}

/**
 * Tier 2: 오래된 대화를 LLM으로 요약하여 압축합니다.
 * System(0번) + 요약 + 최근 PRESERVE_RECENT개 보존.
 */
async function tier2Summarize(messages: Message[], provider: LLMProvider): Promise<Message[]> {
  const systemMessage = messages[0]
  const preserved = messages.slice(-PRESERVE_RECENT)
  const toSummarize = messages.slice(1, -PRESERVE_RECENT)

  if (toSummarize.length === 0) return messages

  const summaryInput = toSummarize.map(m => {
    const role = m.role.toUpperCase()
    const content = typeof m.content === 'string'
      ? m.content.slice(0, 500)  // 각 메시지 최대 500자만
      : JSON.stringify(m).slice(0, 500)
    return `[${role}] ${content}`
  }).join('\n---\n')

  const summary = await provider.complete(
    `You are summarizing a prior conversation between an AI coding agent and a user.
Preserve:
- Key decisions made
- Files modified and why
- Unresolved issues or pending tasks
- Important code patterns discovered

Be concise but comprehensive. Output in the same language as the conversation.

Conversation:
${summaryInput}

Summary:`
  )

  return [
    systemMessage,
    {
      role: 'system' as const,
      content: `[이전 대화 요약 — ${toSummarize.length}개 메시지 압축]\n\n${summary}`,
    },
    ...preserved,
  ]
}

/**
 * Tier 3: 비상 잘라내기. System + 마지막 3개 메시지만 보존.
 */
function tier3HardReset(messages: Message[]): Message[] {
  const systemMessage = messages[0]
  const lastMessages = messages.slice(-3)
  return [
    systemMessage,
    {
      role: 'system' as const,
      content: '[⚠️ 컨텍스트 한계 도달 — 이전 대화가 제거되었습니다. 필요한 정보는 다시 요청하세요.]',
    },
    ...lastMessages,
  ]
}

/**
 * 메인 압축 함수 — 3-Tier 전략 적용.
 *
 * @param messages   현재 대화 메시지 배열
 * @param contextWindow  모델의 컨텍스트 윈도우 크기
 * @param provider   LLM 프로바이더 (Tier 2 요약용)
 * @returns 압축된 메시지 배열 + 적용된 Tier 정보
 */
export async function compactMessages(
  messages: Message[],
  contextWindow: number,
  provider: LLMProvider
): Promise<{ messages: Message[]; tier: 0 | 1 | 2 | 3 }> {
  const tokens = totalTokens(messages)
  const ratio = tokens / contextWindow

  // 임계값 미달 — 압축 불필요
  if (ratio < TIER1_THRESHOLD) {
    return { messages, tier: 0 }
  }

  // ── Tier 1 ──
  let compacted = tier1TrimToolOutputs(messages)
  if (totalTokens(compacted) / contextWindow < TIER2_THRESHOLD) {
    log.info(`Tier 1 적용: ${tokens} → ${totalTokens(compacted)} tokens`)
    return { messages: compacted, tier: 1 }
  }

  // ── Tier 2 ──
  try {
    compacted = await tier2Summarize(compacted, provider)
    log.info(`Tier 2 적용: ${tokens} → ${totalTokens(compacted)} tokens`)
    return { messages: compacted, tier: 2 }
  } catch (e) {
    log.warn('Tier 2 실패, Tier 3로 fallback:', e)
  }

  // ── Tier 3 ──
  compacted = tier3HardReset(messages)
  log.warn(`Tier 3 적용 (비상 잘라내기): ${tokens} → ${totalTokens(compacted)} tokens`)
  return { messages: compacted, tier: 3 }
}
