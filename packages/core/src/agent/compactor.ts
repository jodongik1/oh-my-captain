import type { LLMProvider, Message } from '../providers/types.js'
import { estimateTokens } from './loop.js'

const COMPACT_THRESHOLD = 0.75  // 75% 초과 시 압축 시작

/**
 * 컨텍스트 윈도우 초과 시 이전 대화를 요약하여 압축합니다.
 * system 메시지(0번)와 마지막 3개 메시지를 보존하고,
 * 나머지를 LLM 요약으로 교체합니다.
 */
export async function compactMessages(
  messages: Message[],
  contextWindow: number,
  provider: LLMProvider
): Promise<Message[]> {
  const totalTokens = messages.reduce(
    (sum, m) => sum + estimateTokens(typeof m.content === 'string' ? m.content : JSON.stringify(m)),
    0
  )

  if (totalTokens < contextWindow * COMPACT_THRESHOLD) {
    return messages  // 아직 압축 불필요
  }

  // 보존 영역: system(0번) + 마지막 3개
  const systemMessage = messages[0]
  const preserveCount = 3
  const preserved = messages.slice(-preserveCount)
  const toSummarize = messages.slice(1, -preserveCount)

  if (toSummarize.length === 0) return messages  // 요약할 내용 없음

  // 요약 대상 텍스트 조립
  const summaryInput = toSummarize.map(m => {
    const role = m.role.toUpperCase()
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m)
    return `[${role}] ${content}`
  }).join('\n---\n')

  try {
    const summary = await provider.complete(
      `다음은 AI 코딩 에이전트와 사용자 간의 이전 대화입니다. 핵심 내용만 간결하게 요약해주세요.
주요 결정사항, 변경된 파일, 해결된/미해결 문제를 보존하세요.

대화 내용:
${summaryInput}

요약:`
    )

    return [
      systemMessage,
      {
        role: 'system' as const,
        content: `[이전 대화 요약]\n${summary}`
      },
      ...preserved
    ]
  } catch (e) {
    // 요약 실패 시 단순 잘라내기로 fallback
    console.warn('[Compactor] 요약 실패, 단순 잘라내기 사용:', e)
    return [systemMessage, ...preserved]
  }
}
