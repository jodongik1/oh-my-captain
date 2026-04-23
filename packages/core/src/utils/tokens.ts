/**
 * 토큰 수 추정 유틸리티.
 *
 * LLM API 호출 전 컨텍스트 윈도우 사용량을 추정하는 데 사용됩니다.
 * 정확한 토크나이저 대신 문자 수 기반 근사값을 사용합니다 (1 토큰 ≈ 4 문자).
 */

import type { Message } from '../providers/types.js'

/**
 * 텍스트의 토큰 수를 근사적으로 추정합니다.
 * - 영어/일반 기호: 1 토큰 ≈ 4 문자
 * - 한국어(한글): 1 토큰 ≈ 0.5 문자 (1글자당 약 2~2.5토큰)
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  
  // 한글 포함 여부를 대략적으로 확인 (성능을 위해 정규식 매칭)
  const koreanMatches = text.match(/[가-힣]/g)
  const koreanCount = koreanMatches ? koreanMatches.length : 0
  const otherCount = text.length - koreanCount
  
  // 한국어는 글자당 약 2.2토큰, 기타는 4글자당 1토큰(0.25토큰)
  const tokens = (koreanCount * 2.2) + (otherCount * 0.25)
  return Math.ceil(tokens)
}

/** 메시지 배열의 총 토큰 수를 추정합니다 */
export function totalTokens(messages: Message[]): number {
  return messages.reduce(
    (sum, m) => sum + estimateTokens(typeof m.content === 'string' ? m.content : JSON.stringify(m)),
    0
  )
}
