/**
 * 토큰 수 추정 유틸리티.
 *
 * LLM API 호출 전 컨텍스트 윈도우 사용량을 추정하는 데 사용됩니다.
 * 정확한 토크나이저 대신 문자 수 기반 근사값을 사용합니다 (1 토큰 ≈ 4 문자).
 */

import type { Message } from '../providers/types.js'

/** 텍스트의 토큰 수를 근사적으로 추정합니다 (1 토큰 ≈ 4 문자) */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/** 메시지 배열의 총 토큰 수를 추정합니다 */
export function totalTokens(messages: Message[]): number {
  return messages.reduce(
    (sum, m) => sum + estimateTokens(typeof m.content === 'string' ? m.content : JSON.stringify(m)),
    0
  )
}
