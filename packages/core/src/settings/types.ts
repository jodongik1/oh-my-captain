export type ApiProvider = 'ollama' | 'openai' | 'anthropic'

export interface ProviderSettings {
  provider: ApiProvider
  // Ollama
  ollamaBaseUrl: string            // 기본: 'http://localhost:11434' / 커스텀 URL 허용
  ollamaApiKey: string             // 로컬 설치면 빈 값, 클라우드 인증 시 사용
  ollamaModel: string              // 예: 'qwen3-coder:30b'
  // OpenAI (Phase 2)
  openAiApiKey: string
  openAiModel: string
  openAiBaseUrl: string            // Azure 등 커스텀 엔드포인트
  // Anthropic (Phase 2)
  anthropicApiKey: string
  anthropicModel: string
}

export interface ModelSettings {
  contextWindow: number            // 모델 선택 시 /api/show에서 자동 감지. 사용자 수동 오버라이드 가능. num_ctx에 전달
  requestTimeoutMs: number         // 기본: 30000 (30초). p-timeout에 사용
}

export interface CachedModelInfo {
  id: string
  name: string
  contextWindow?: number
}

export interface CaptainSettings {
  provider: ProviderSettings
  model: ModelSettings
  cachedModels?: CachedModelInfo[]
}

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
  }
}
