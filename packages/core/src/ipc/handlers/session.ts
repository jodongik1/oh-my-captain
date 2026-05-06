import { registerHandler, send } from '../server.js'
import { replyError } from '../reply.js'
import * as sessionDb from '../../db/session.js'
import { makeLogger } from '../../utils/logger.js'
import type { CoreState } from './state.js'

const log = makeLogger('session.ts')

export function registerSessionHandlers(state: CoreState) {
  registerHandler('session_select', async (msg) => {
    try {
      const { sessionId } = msg.payload
      state.sessionId = sessionId
      const messages = sessionDb.getSessionMessages(sessionId)
      // 도구 호출/결과 메타까지 LLM 컨텍스트에 정확히 복원 — 평문 user/assistant 만 복원하면
      // 재개 시 모델이 이전 도구 사용을 인지하지 못하는 회귀가 생긴다.
      state.history = messages.map((m) => {
        if (m.role === 'tool') {
          return {
            role: 'tool' as const,
            tool_call_id: m.toolCallId ?? '',
            content: m.content,
          }
        }
        if (m.role === 'assistant') {
          const tool_calls = m.toolCalls?.map(tc => ({
            id: tc.id,
            function: { name: tc.name, arguments: tc.args as Record<string, unknown> },
          }))
          return {
            role: 'assistant' as const,
            content: m.content,
            ...(tool_calls && tool_calls.length > 0 ? { tool_calls } : {}),
          }
        }
        return { role: 'user' as const, content: m.content }
      })
      send({ id: msg.id, type: 'session_history', payload: { sessionId, messages } })
      log.info(`세션 선택: ${sessionId} (${messages.length}개 메시지)`)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      log.error(`세션 선택 실패: ${message}`)
      replyError((m) => send(m), msg.id, `세션 선택 실패: ${message}`, true)
    }
  })

  registerHandler('session_new', (msg) => {
    state.sessionId = null
    state.history = []
    send({ id: msg.id, type: 'ready', payload: {} })
    log.info('새 세션 시작')
  })

  registerHandler('session_list', async (msg) => {
    try {
      const sessions = sessionDb.listSessions()
      send({ id: msg.id, type: 'sessions_list', payload: { sessions } })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      log.error(`세션 목록 조회 실패: ${message}`)
      replyError((m) => send(m), msg.id, `세션 목록 조회 실패: ${message}`, true)
    }
  })

  registerHandler('session_delete', async (msg) => {
    try {
      const { sessionId } = msg.payload
      sessionDb.deleteSession(sessionId)
      if (state.sessionId === sessionId) {
        state.sessionId = null
        state.history = []
      }
      log.info(`세션 삭제: ${sessionId}`)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      log.error(`세션 삭제 실패: ${message}`)
      replyError((m) => send(m), msg.id, `세션 삭제 실패: ${message}`, true)
    }
  })

  registerHandler('session_rename', async (msg) => {
    try {
      sessionDb.renameSession(msg.payload.sessionId, msg.payload.title)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      log.error(`세션 이름 변경 실패: ${message}`)
      replyError((m) => send(m), msg.id, `세션 이름 변경 실패: ${message}`, true)
    }
  })
}
