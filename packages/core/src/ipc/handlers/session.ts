import { registerHandler, send } from '../server.js'
import * as sessionDb from '../../db/session.js'
import type { CoreState } from './state.js'

export function registerSessionHandlers(state: CoreState) {
  registerHandler('session_select', async (msg) => {
    const { sessionId } = msg.payload as { sessionId: string }
    state.sessionId = sessionId
    const messages = sessionDb.getSessionMessages(sessionId)
    state.history = messages.map((m) => ({ role: m.role as any, content: m.content }))
    send({ id: msg.id, type: 'session_history', payload: { sessionId, messages } })
  })

  registerHandler('session_new', (msg) => {
    state.sessionId = null
    state.history = []
    send({ id: msg.id, type: 'ready', payload: {} })
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
  })

  registerHandler('session_rename', async (msg) => {
    const { sessionId, title } = msg.payload as { sessionId: string; title: string }
    sessionDb.renameSession(sessionId, title)
  })
}
