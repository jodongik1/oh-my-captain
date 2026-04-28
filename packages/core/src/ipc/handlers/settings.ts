import { registerHandler, send } from '../server.js'
import { replyError } from '../reply.js'
import { SettingsManager } from '../../settings/manager.js'
import { applySettings } from '../../providers/factory.js'
import { makeLogger } from '../../utils/logger.js'
import type { CoreState } from './state.js'

const log = makeLogger('settings.ts')

export function registerSettingsHandlers(state: CoreState) {
  registerHandler('settings_get', (msg) => {
    try {
      const { settings, isFirstTime } = SettingsManager.load()
      applySettings(state, settings)
      log.debug(`settings_get sending settings : -> \n`, settings)
      send({ id: msg.id, type: 'settings_loaded', payload: { settings, isFirstTime } })
      log.info(`설정 로드 (provider: ${state.settings.provider.provider}, isFirstTime: ${isFirstTime})`)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      log.error(`설정 로드 실패: ${message}`)
      replyError((m) => send(m), msg.id, `설정 로드 실패: ${message}`, true)
    }
  })

  registerHandler('settings_update', (msg) => {
    try {
      applySettings(state, msg.payload, { save: true, keepCachedModels: true })
      send({ id: msg.id, type: 'settings_loaded', payload: { settings: state.settings, isFirstTime: false } })
      log.info(`설정 업데이트 및 저장완료 (provider: ${state.settings.provider.provider})`)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      log.error(`설정 저장 실패: ${message}`)
      replyError((m) => send(m), msg.id, `설정 저장 실패: ${message}`, true)
    }
  })
}
