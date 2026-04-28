// 설정 타입 + 런타임 검증의 단일 소스.
// zod 스키마를 정규로 두고 z.infer 로 타입을 도출 — 신규 필드 추가 시 한 곳만 수정하면 된다.
//
// core 는 SettingsManager 에서 captainSettingsSchema.safeParse 로 사용자 settings.json 을 검증한다.
// webview 는 type-only import 로 zod 런타임을 번들에 포함시키지 않는다 (vite tree-shake).

import { z } from 'zod'

export const apiProviderSchema = z.enum(['ollama', 'openai', 'anthropic'])
export type ApiProvider = z.infer<typeof apiProviderSchema>

export const providerSettingsSchema = z.object({
  provider: apiProviderSchema,
  ollamaBaseUrl: z.string(),
  ollamaApiKey: z.string(),
  ollamaModel: z.string(),
  openAiApiKey: z.string(),
  openAiModel: z.string(),
  openAiBaseUrl: z.string(),
  anthropicApiKey: z.string(),
  anthropicModel: z.string(),
})
export type ProviderSettings = z.infer<typeof providerSettingsSchema>

export const modelSettingsSchema = z.object({
  /** 모델 선택 시 자동 감지(또는 사용자 오버라이드)된 컨텍스트 윈도우 토큰 수 */
  contextWindow: z.number().int().positive(),
  /** 요청 타임아웃 (ms) */
  requestTimeoutMs: z.number().int().positive(),
})
export type ModelSettings = z.infer<typeof modelSettingsSchema>

export const cachedModelInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  contextWindow: z.number().int().positive().optional(),
})
export type CachedModelInfo = z.infer<typeof cachedModelInfoSchema>

export const captainSettingsSchema = z.object({
  provider: providerSettingsSchema,
  model: modelSettingsSchema,
  cachedModels: z.array(cachedModelInfoSchema).optional(),
})
export type CaptainSettings = z.infer<typeof captainSettingsSchema>

export const DEFAULT_SETTINGS: CaptainSettings = {
  provider: {
    provider: 'ollama',
    ollamaBaseUrl: 'http://localhost:11434',
    ollamaApiKey: '',
    ollamaModel: 'qwen3-coder:30b',
    openAiApiKey: '',
    openAiModel: 'gpt-4o',
    openAiBaseUrl: 'https://api.openai.com/v1',
    anthropicApiKey: '',
    anthropicModel: 'claude-sonnet-4-20250514',
  },
  model: {
    contextWindow: 32768,
    requestTimeoutMs: 30000,
  },
}
