import { registerHandler } from '../server.js'
import { executeCodeAction } from '../../actions/handler.js'
import type { CodeActionPayload } from '../protocol.js'
import type { CoreState } from './state.js'

export function registerCodeActionHandlers(state: CoreState) {
  registerHandler('code_action', async (msg) => {
    if (!state.provider || !state.host) return
    const payload = msg.payload as CodeActionPayload
    const controller = new AbortController()
    state.codeActionController = controller
    try {
      await executeCodeAction(payload, state.provider, state.host, controller.signal)
    } catch (e: any) {
      if (!controller.signal.aborted) {
        state.host.emit('error', { message: `코드 액션 실패: ${e.message}`, retryable: false })
      }
    } finally {
      state.codeActionController = null
    }
  })
}
