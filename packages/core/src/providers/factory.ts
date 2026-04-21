/**
 * LLM 프로바이더 팩토리.
 *
 * CaptainSettings를 기반으로 적절한 LLM 프로바이더 인스턴스를 생성합니다.
 * 설정 변경 시 프로바이더를 재생성하는 applySettings 헬퍼도 제공합니다.
 */

import { OllamaProvider } from './ollama.js'
import { OpenAIProvider } from './openai.js'
import { AnthropicProvider } from './anthropic.js'
import { SettingsManager } from '../settings/manager.js'
import type { LLMProvider } from './types.js'
import type { CaptainSettings } from '../settings/types.js'
import type { CoreState } from '../ipc/handlers/state.js'

/** 설정에 따라 적절한 LLM 프로바이더를 생성합니다 */
export function createProvider(s: CaptainSettings): LLMProvider {
  const timeout = s.model.requestTimeoutMs
  const ctx = s.model.contextWindow

  switch (s.provider.provider) {
    case 'openai':
      return new OpenAIProvider({
        model: s.provider.openAiModel,
        apiKey: s.provider.openAiApiKey,
        baseUrl: s.provider.openAiBaseUrl,
        contextWindow: ctx,
        requestTimeoutMs: timeout,
      })
    case 'anthropic':
      return new AnthropicProvider({
        model: s.provider.anthropicModel,
        apiKey: s.provider.anthropicApiKey,
        contextWindow: ctx,
        requestTimeoutMs: timeout,
      })
    case 'ollama':
    default:
      return new OllamaProvider({
        model: s.provider.ollamaModel,
        baseUrl: s.provider.ollamaBaseUrl,
        apiKey: s.provider.ollamaApiKey || undefined,
        contextWindow: ctx,
        requestTimeoutMs: timeout,
      })
  }
}

/**
 * 설정 갱신 → 프로바이더 재생성 → (옵션) 저장.
 * settings_get / settings_update / model_switch 핸들러에서 공통 사용.
 */
export function applySettings(
  state: CoreState,
  next: CaptainSettings,
  opts: { save?: boolean; keepCachedModels?: boolean } = {},
) {
  state.settings = opts.keepCachedModels
    ? { ...next, cachedModels: state.settings.cachedModels ?? next.cachedModels }
    : next
  if (state.host) {
    state.provider = createProvider(state.settings)
  }
  if (opts.save) SettingsManager.save(state.settings)
}
