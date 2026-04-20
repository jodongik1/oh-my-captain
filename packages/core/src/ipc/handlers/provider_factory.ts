import { OllamaProvider } from '../../providers/ollama.js'
import { OpenAIProvider } from '../../providers/openai.js'
import { AnthropicProvider } from '../../providers/anthropic.js'
import { SettingsManager } from '../../settings/manager.js'
import type { LLMProvider } from '../../providers/types.js'
import type { CaptainSettings } from '../protocol.js'
import type { CoreState } from './state.js'

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

// settings 갱신 → provider 재생성 → (옵션) 저장. settings_get/update/model_switch에서 공통 사용.
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
