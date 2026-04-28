import { registerHandler, send } from '../server.js'
import { replyError } from '../reply.js'
import { IpcHostAdapter } from '../../host/ipc_adapter.js'
import { makeLogger } from '../../utils/logger.js'
import { createProvider } from '../../providers/factory.js'
import type { CoreState } from './state.js'

const log = makeLogger('lifecycle.ts')

export function registerLifecycleHandlers(state: CoreState) {
  registerHandler('init', (msg) => {
    try {
      const { projectRoot, mode } = msg.payload
      state.host = new IpcHostAdapter(projectRoot, mode)
      state.provider = createProvider(state.settings)
      const ok = send({ id: msg.id, type: 'ready', payload: {} })
      if (!ok) log.warn('init ready 응답 전송 실패 (stdout 종료?)')
      log.info(`초기화 완료: ${projectRoot}, provider: ${state.settings.provider.provider}`)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      log.error(`초기화 실패: ${message}`)
      replyError((m) => send(m), msg.id, `초기화 실패: ${message}`, false)
    }
  })

  registerHandler('mode_change', (msg) => {
    state.host?.setMode(msg.payload.mode)
    log.info(`Mode 변경: ${msg.payload.mode}`)
  })
}
