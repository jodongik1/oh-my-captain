import { registerHandler } from '../server.js'
import { executeCodeAction } from '../../actions/handler.js'
import { makeLogger } from '../../utils/logger.js'
import type { CodeActionPayload } from '../protocol.js'
import type { CoreState } from './state.js'

const log = makeLogger('code_action.ts')

export function registerCodeActionHandlers(state: CoreState) {
  registerHandler('code_action', async (msg) => {
    if (!state.provider || !state.host) return
    const payload = msg.payload as CodeActionPayload
    // 이전 액션이 아직 진행 중이면 강제 종료. (사용자가 우클릭을 빠르게 두 번 한 경우 race 방지)
    state.codeActionController?.abort()
    const controller = new AbortController()
    state.codeActionController = controller
    try {
      await executeCodeAction(payload, state.provider, state.host, controller.signal)
    } catch (e: any) {
      if (!controller.signal.aborted) {
        state.host.emit('error', { message: `코드 액션 실패: ${e.message}`, retryable: false })
      }
    } finally {
      // 다른 액션이 사이에 새 controller 를 등록했을 수 있으므로 우리 것일 때만 비운다.
      if (state.codeActionController === controller) {
        state.codeActionController = null
      }
    }
  })

  /**
   * webview 슬래시 → IDE 등록 action 트리거.
   * 실제 액션(예: omc.explain) 은 host(IDE) 측 ActionManager 가 실행하며,
   * 액션 내부에서 PSI 컨텍스트를 수집해 별도로 'code_action' IPC 를 발사한다.
   * core 는 단순히 host 에 명령만 전달.
   */
  registerHandler('invoke_ide_action', async (msg) => {
    if (!state.host) return
    const { actionId } = msg.payload as { actionId: string }
    log.info(`IDE action 호출: ${actionId}`)
    try {
      await state.host.invokeIdeAction?.(actionId)
    } catch (e: any) {
      state.host.emit('error', {
        message: `IDE 액션 '${actionId}' 실행에 실패했습니다: ${e?.message ?? String(e)}`,
        retryable: false,
      })
    }
  })
}
