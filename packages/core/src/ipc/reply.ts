import type { CoreMessage, IntellijMessage } from '@omc/protocol'
import { makeLogger } from '../utils/logger.js'
import type { TypedHandler } from './server.js'

const log = makeLogger('reply.ts')

/** 표준 error 메시지 전송 */
export function replyError(
  reply: (msg: CoreMessage) => void,
  id: string,
  message: string,
  retryable = false,
): void {
  reply({ id, type: 'error', payload: { message, retryable } })
}

/**
 * 핸들러를 try/catch 로 감싸 미처리 예외를 표준 error 메시지로 변환.
 * 핸들러가 자체적으로 더 구체적인 응답을 보내야 한다면 직접 try/catch.
 */
export function safeHandler<T extends IntellijMessage['type']>(
  fn: TypedHandler<T>,
): TypedHandler<T> {
  return async (msg, reply) => {
    try {
      await fn(msg, reply)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      log.error(`핸들러 에러 (${msg.type}):`, e)
      replyError(reply, msg.id, message, true)
    }
  }
}
