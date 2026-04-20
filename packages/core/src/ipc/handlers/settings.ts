import { registerHandler, send } from '../server.js'
import { SettingsManager } from '../../settings/manager.js'
import { makeLogger } from '../../utils/logger.js'
import type { CaptainSettings } from '../protocol.js'
import type { CoreState } from './state.js'
import { applySettings } from './provider_factory.js'

const log = makeLogger('Core')

export function registerSettingsHandlers(state: CoreState) {
  registerHandler('settings_get', (msg) => {
    const { settings, isFirstTime } = SettingsManager.load()
    applySettings(state, settings)
    log.debug(`settings_get sending settings: ${JSON.stringify(settings)}`)
    send({ id: msg.id, type: 'settings_loaded', payload: { settings, isFirstTime } })
    log.info(`설정 로드 (provider: ${state.settings.provider.provider}, isFirstTime: ${isFirstTime})`)
  })

  registerHandler('settings_update', (msg) => {
    const incoming = msg.payload as CaptainSettings
    applySettings(state, incoming, { save: true, keepCachedModels: true })
    send({ id: msg.id, type: 'settings_loaded', payload: { settings: state.settings, isFirstTime: false } })
    log.info(`설정 업데이트 및 저장완료 (provider: ${state.settings.provider.provider})`)
  })
}
