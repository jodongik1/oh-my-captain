// IPC 메시지 타입 전체 정의 (NDJSON, 한 줄 = 한 메시지)

export interface IPCMessage {
  id: string       // nanoid → 요청-응답 상관관계 추적용
  type: string
  payload: unknown
}

// ── IntelliJ → Core ──────────────────────────────────────────────
export type IntellijMessage =
  | { id: string; type: 'init';                  payload: InitPayload }
  | { id: string; type: 'user_message';          payload: { text: string; sessionId?: string } }
  | { id: string; type: 'context_response';      payload: FileContext[] }
  | { id: string; type: 'approval_response';     payload: { approved: boolean } }
  | { id: string; type: 'abort';                 payload: Record<string, never> }
  | { id: string; type: 'mode_change';           payload: { mode: 'plan' | 'ask' | 'auto' } }
  | { id: string; type: 'settings_get';          payload: Record<string, never> }
  | { id: string; type: 'settings_update';       payload: CaptainSettings }
  | { id: string; type: 'fetch_models';          payload: Record<string, never> }
  // ── 세션 관리 ──
  | { id: string; type: 'session_select';        payload: { sessionId: string } }
  | { id: string; type: 'session_list';          payload: Record<string, never> }
  | { id: string; type: 'session_new';           payload: Record<string, never> }
  | { id: string; type: 'session_delete';        payload: { sessionId: string } }
  | { id: string; type: 'session_rename';        payload: { sessionId: string; title: string } }
  // ── 모델 선택 ──
  | { id: string; type: 'model_list';            payload: Record<string, never> }
  | { id: string; type: 'model_switch';          payload: { modelId: string } }
  // ── 연결 테스트 ──
  | { id: string; type: 'connection_test';       payload: { baseUrl: string; apiKey?: string } }
  // ── 코드 액션 ──
  | { id: string; type: 'code_action';           payload: CodeActionPayload }
  // ── 스티어링 큐 (실행 중 사용자 개입) ──
  | { id: string; type: 'steer_inject';          payload: { text: string } }
  | { id: string; type: 'steer_interrupt';       payload: Record<string, never> }

export interface InitPayload {
  projectRoot: string
  nodeVersion: string
  mode: 'plan' | 'ask' | 'auto'  // 기본: 'ask'
}

// ── Core → IntelliJ ──────────────────────────────────────────────
export type CoreMessage =
  | { id: string; type: 'ready';             payload: Record<string, never> }
  | { id: string; type: 'context_request';   payload: { paths: string[] } }
  | { id: string; type: 'approval_request';  payload: ApprovalRequest }
  | { id: string; type: 'safety_snapshot';   payload: { path: string } }
  | { id: string; type: 'stream_start';      payload: { source: 'chat' | 'action' } }
  | { id: string; type: 'stream_chunk';      payload: { token: string } }
  | { id: string; type: 'stream_end';        payload: Record<string, never> }
  | { id: string; type: 'thinking_start';    payload: Record<string, never> }
  | { id: string; type: 'thinking_end';      payload: { durationMs: number } }
  | { id: string; type: 'tool_start';        payload: { tool: string; args: unknown } }
  | { id: string; type: 'tool_result';       payload: { tool: string; result: unknown } }
  | { id: string; type: 'open_in_editor';    payload: { path: string; line?: number } }
  | { id: string; type: 'error';             payload: { message: string; retryable: boolean } }
  | { id: string; type: 'context_usage';     payload: { usedTokens: number; maxTokens: number; percentage: number } }
  // ── 압축 ──
  | { id: string; type: 'compaction';        payload: { tier: number; beforeTokens: number; afterTokens: number } }
  // ── 권한 ──
  | { id: string; type: 'permission_denied'; payload: { tool: string; reason: string; mode: string } }
  // ── 설정 ──
  | { id: string; type: 'settings_loaded';   payload: { settings: CaptainSettings; isFirstTime: boolean } }
  | { id: string; type: 'models_list';       payload: { models: string[] } }
  // ── 세션 관리 ──
  | { id: string; type: 'sessions_list';     payload: { sessions: SessionSummary[] } }
  | { id: string; type: 'session_history';   payload: { sessionId: string; messages: Message[] } }
  // ── 연결 테스트 ──
  | { id: string; type: 'connection_test_result'; payload: { success: boolean; models?: ModelInfo[]; error?: string } }
  // ── 모델 선택 ──
  | { id: string; type: 'model_list_result'; payload: { models: ModelInfo[]; currentModel: string } }
  | { id: string; type: 'model_switched';    payload: { modelId: string; contextWindow: number } }

export interface ModelInfo {
  id: string
  name: string
  contextWindow?: number
}

export type CodeActionType = 'explain' | 'review' | 'impact' | 'query_validation' | 'improve' | 'generate_test'

export interface CodeActionPayload {
  action: CodeActionType
  code: string            // 선택된 코드 또는 전체 파일 내용
  filePath: string        // 파일 경로
  language: string        // 언어 (kotlin, java, typescript 등)
  lineRange?: { start: number; end: number }  // 선택 범위 (선택적)
}

export interface ApprovalRequest {
  action: string
  description: string
  risk: 'low' | 'medium' | 'high'
  details?: unknown
  diff?: string
}

export interface FileContext {
  path: string
  language: string
  content: string
  symbols: Symbol[]
  imports: string[]
  diagnostics: Diagnostic[]
}

export interface Symbol {
  kind: 'class' | 'function' | 'variable' | 'interface' | 'type'
  name: string
  line: number
}

export interface Diagnostic {
  severity: 'error' | 'warning' | 'info'
  message: string
  line: number
}

export interface SessionSummary {
  id: string
  title: string
  updatedAt: number
  messageCount: number
  preview: string
}

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  timestamp: number
}

export interface CaptainSettings {
  provider: {
    provider: 'ollama' | 'openai' | 'anthropic'
    ollamaBaseUrl: string
    ollamaApiKey: string
    ollamaModel: string
    openAiApiKey: string
    openAiModel: string
    openAiBaseUrl: string
    anthropicApiKey: string
    anthropicModel: string
  }
  model: {
    contextWindow: number
    requestTimeoutMs: number
  }
}
