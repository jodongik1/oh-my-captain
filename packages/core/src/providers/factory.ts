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
import type { ApiProvider, CaptainSettings } from '../settings/types.js'
import type { CoreState } from '../ipc/handlers/state.js'

type ProviderBuilder = (s: CaptainSettings) => LLMProvider

/**
 * provider 종류 → 인스턴스 빌더 매핑.
 * Record<ApiProvider, ...> 강제로 새 ApiProvider 추가 시 컴파일 에러 → 누락 방지 (OCP).
 */
const PROVIDER_BUILDERS: Record<ApiProvider, ProviderBuilder> = {
  openai: (s) => new OpenAIProvider({
    model: s.provider.openAiModel,
    apiKey: s.provider.openAiApiKey,
    baseUrl: s.provider.openAiBaseUrl,
    contextWindow: s.model.contextWindow,
    requestTimeoutMs: s.model.requestTimeoutMs,
  }),
  anthropic: (s) => new AnthropicProvider({
    model: s.provider.anthropicModel,
    apiKey: s.provider.anthropicApiKey,
    contextWindow: s.model.contextWindow,
    requestTimeoutMs: s.model.requestTimeoutMs,
  }),
  ollama: (s) => new OllamaProvider({
    model: s.provider.ollamaModel,
    baseUrl: s.provider.ollamaBaseUrl,
    apiKey: s.provider.ollamaApiKey || undefined,
    contextWindow: s.model.contextWindow,
    requestTimeoutMs: s.model.requestTimeoutMs,
  }),
}

/** 설정에 따라 적절한 LLM 프로바이더를 생성합니다 */
export function createProvider(s: CaptainSettings): LLMProvider {
  return PROVIDER_BUILDERS[s.provider.provider](s)
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
