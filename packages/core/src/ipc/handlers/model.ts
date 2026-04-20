import { registerHandler, send } from '../server.js'
import { fetchOllamaModels, fetchOllamaModelInfo } from '../../providers/ollama.js'
import { SettingsManager } from '../../settings/manager.js'
import { makeLogger } from '../../utils/logger.js'
import type { CoreState } from './state.js'
import { applySettings } from './provider_factory.js'

const log = makeLogger('Core')

export function registerModelHandlers(state: CoreState) {
  registerHandler('connection_test', async (msg) => {
    const { baseUrl, apiKey } = msg.payload as { baseUrl: string; apiKey?: string }
    try {
      const models = await fetchOllamaModels(baseUrl, apiKey)
      const modelInfos = await Promise.all(
        models.map(async (id) => {
          try {
            const info = await fetchOllamaModelInfo(baseUrl, id, apiKey)
            return { id, name: id, contextWindow: info.contextWindow }
          } catch {
            return { id, name: id }
          }
        }),
      )
      state.settings.cachedModels = modelInfos
      SettingsManager.save(state.settings)
      send({ id: msg.id, type: 'connection_test_result', payload: { success: true, models: modelInfos } })
      log.info(`연결 테스트 성공: ${baseUrl}, ${models.length}개 모델`)
    } catch (e: any) {
      send({ id: msg.id, type: 'connection_test_result', payload: { success: false, error: e.message } })
      log.error(`연결 테스트 실패: ${e.message}`)
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
            return { id, name: id, contextWindow: info.contextWindow }
          } catch {
            return { id, name: id }
          }
        }),
      )
      send({ id: msg.id, type: 'model_list_result', payload: { models: modelInfos, currentModel: ollamaModel } })
    } catch (e: any) {
      send({ id: msg.id, type: 'error', payload: { message: `모델 목록 조회 실패: ${e.message}`, retryable: true } })
    }
  })

  registerHandler('model_switch', async (msg) => {
    const { modelId } = msg.payload as { modelId: string }
    state.settings.provider.ollamaModel = modelId
    try {
      const info = await fetchOllamaModelInfo(
        state.settings.provider.ollamaBaseUrl,
        modelId,
        state.settings.provider.ollamaApiKey || undefined,
      )
      state.settings.model.contextWindow = info.contextWindow
      applySettings(state, state.settings, { save: true })
      send({ id: msg.id, type: 'model_switched', payload: { modelId, contextWindow: info.contextWindow } })
    } catch (e: any) {
      send({ id: msg.id, type: 'error', payload: { message: `모델 전환 실패: ${e.message}`, retryable: false } })
    }
  })
}
