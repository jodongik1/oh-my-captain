import { registerHandler, send } from '../server.js'
import { IpcHostAdapter } from '../../host/ipc_adapter.js'
import { makeLogger } from '../../utils/logger.js'
import type { InitPayload } from '../protocol.js'
import type { CoreState } from './state.js'
import { createProvider } from './provider_factory.js'

const log = makeLogger('lifecycle.ts')

export function registerLifecycleHandlers(state: CoreState) {
  registerHandler('init', (msg) => {
    const payload = msg.payload as InitPayload
    state.host = new IpcHostAdapter(payload.projectRoot, payload.mode)
    state.provider = createProvider(state.settings)
    send({ id: msg.id, type: 'ready', payload: {} })
    log.info(`초기화 완료: ${payload.projectRoot}, provider: ${state.settings.provider.provider}`)
  })

  registerHandler('mode_change', (msg) => {
    const { mode } = msg.payload as { mode: 'plan' | 'ask' | 'auto' }
    state.host?.setMode(mode)
    log.info(`Mode 변경: ${mode}`)
  })
}
