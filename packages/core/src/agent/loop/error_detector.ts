/**
 * 도구 에러 반복 감지 — 동일 시그니처 에러가 N회 연속이면 루프 조기 중단.
 */

import type { Message } from '../../providers/types.js'
import { LOOP_TUNING } from '../tuning.js'
import { makeLogger } from '../../utils/logger.js'

const log = makeLogger('error_detector.ts')

const MAX_CONSECUTIVE = LOOP_TUNING.maxConsecutiveErrors

export interface ErrorObservation {
  shouldBreak: boolean
  /** shouldBreak=true 일 때 host.emit('error', ...) 에 사용할 사용자 메시지 */
  userMessage?: string
}

export class ToolErrorDetector {
  private lastSignature: string | null = null
  private count = 0

  observe(latestToolMessages: Message[]): ErrorObservation {
    const errors = latestToolMessages
      .filter((m): m is Message & { role: 'tool'; content: string } => m.role === 'tool')
      .map(m => extractError(m.content))
      .filter((s): s is string => Boolean(s))

    if (errors.length === 0) {
      this.lastSignature = null
      this.count = 0
      return { shouldBreak: false }
    }

    const current = errors.join('|')
    if (current === this.lastSignature) {
      this.count++
      log.warn(`반복 에러 (${this.count}/${MAX_CONSECUTIVE}): ${current.slice(0, 100)}`)
      if (this.count >= MAX_CONSECUTIVE) {
        log.error(`동일 에러 ${MAX_CONSECUTIVE}회 — 루프 조기 중단`)
        return {
          shouldBreak: true,
          userMessage: `같은 오류가 ${MAX_CONSECUTIVE}회 반복되어 작업을 중단합니다. 다른 방법을 시도해 주세요.`,
        }
      }
    } else {
      this.lastSignature = current
      this.count = 1
    }
    return { shouldBreak: false }
  }
}

function extractError(content: string): string | null {
  try {
    const parsed = JSON.parse(content) as { error?: string; __preflight?: boolean }
    return parsed?.error ?? null
  } catch {
    return null
  }
}
