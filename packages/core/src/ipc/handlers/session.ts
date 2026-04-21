import { registerHandler, send } from '../server.js'
import * as sessionDb from '../../db/session.js'
import { makeLogger } from '../../utils/logger.js'
import type { CoreState } from './state.js'

const log = makeLogger('session.ts')

export function registerSessionHandlers(state: CoreState) {
  registerHandler('session_select', async (msg) => {
    const { sessionId } = msg.payload as { sessionId: string }
    state.sessionId = sessionId
    const messages = sessionDb.getSessionMessages(sessionId)
    state.history = messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
    send({ id: msg.id, type: 'session_history', payload: { sessionId, messages } })
    log.info(`세션 선택: ${sessionId} (${messages.length}개 메시지)`)
  })

  registerHandler('session_new', (msg) => {
    state.sessionId = null
    state.history = []
    send({ id: msg.id, type: 'ready', payload: {} })
    log.info('새 세션 시작')
  })

  registerHandler('session_list', async (msg) => {
    const sessions = sessionDb.listSessions()
    send({ id: msg.id, type: 'sessions_list', payload: { sessions } })
  })

  registerHandler('session_delete', async (msg) => {
    const { sessionId } = msg.payload as { sessionId: string }
    sessionDb.deleteSession(sessionId)
    if (state.sessionId === sessionId) {
      state.sessionId = null
      state.history = []
    }
    log.info(`세션 삭제: ${sessionId}`)
  })

  registerHandler('session_rename', async (msg) => {
    const { sessionId, title } = msg.payload as { sessionId: string; title: string }
    sessionDb.renameSession(sessionId, title)
  })
}
