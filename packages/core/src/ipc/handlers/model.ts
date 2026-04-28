import { registerHandler, send } from '../server.js'
import { fetchOllamaModels, fetchOllamaModelInfo } from '../../providers/ollama.js'
import { SettingsManager } from '../../settings/manager.js'
import { applySettings } from '../../providers/factory.js'
import { makeLogger } from '../../utils/logger.js'
import type { CoreState } from './state.js'

const log = makeLogger('model.ts')

export function registerModelHandlers(state: CoreState) {
  registerHandler('connection_test', async (msg) => {
    const { baseUrl, apiKey } = msg.payload
    try {
      const models = await fetchOllamaModels(baseUrl, apiKey)
      const modelInfos = await Promise.all(
        models.map(async (id) => {
          try {
            const info = await fetchOllamaModelInfo(baseUrl, id, apiKey)
            return { id, name: id, contextWindow: info.contextWindow, capabilities: info.capabilities }
          } catch {
            return { id, name: id }
          }
        }),
      )
      state.settings.cachedModels = modelInfos
      SettingsManager.save(state.settings)
      send({ id: msg.id, type: 'connection_test_result', payload: { success: true, models: modelInfos } })
      log.info(`연결 테스트 성공: ${baseUrl}, ${models.length}개 모델`)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      send({ id: msg.id, type: 'connection_test_result', payload: { success: false, error: message } })
      log.error(`연결 테스트 실패: ${message}`)
    }
  })

  registerHandler('model_list', async (msg) => {
    try {
      const { ollamaBaseUrl, ollamaApiKey, ollamaModel } = state.settings.provider
      const models = await fetchOllamaModels(ollamaBaseUrl, ollamaApiKey || undefined)
      const modelInfos = await Promise.all(
        models.map(async (id) => {
          try {
            const info = await fetchOllamaModelInfo(ollamaBaseUrl, id, ollamaApiKey || undefined)
            return { id, name: id, contextWindow: info.contextWindow, capabilities: info.capabilities }
          } catch {
            return { id, name: id }
          }
        }),
      )
      send({ id: msg.id, type: 'model_list_result', payload: { models: modelInfos, currentModel: ollamaModel } })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      send({ id: msg.id, type: 'error', payload: { message: `모델 목록 조회 실패: ${message}`, retryable: true } })
    }
  })

  registerHandler('model_switch', async (msg) => {
    const { modelId } = msg.payload
    state.settings.provider.ollamaModel = modelId
    try {
      const info = await fetchOllamaModelInfo(
        state.settings.provider.ollamaBaseUrl,
        modelId,
        state.settings.provider.ollamaApiKey || undefined,
      )
      state.settings.model.contextWindow = info.contextWindow
      applySettings(state, state.settings, { save: true })
      send({
        id: msg.id,
        type: 'model_switched',
        payload: { modelId, contextWindow: info.contextWindow, capabilities: info.capabilities },
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      send({ id: msg.id, type: 'error', payload: { message: `모델 전환 실패: ${message}`, retryable: false } })
    }
  })
}
