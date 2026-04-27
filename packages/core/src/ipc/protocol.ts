// IPC 메시지 타입 전체 정의 (NDJSON, 한 줄 = 한 메시지)

export interface IPCMessage {
  id: string       // nanoid → 요청-응답 상관관계 추적용
  type: string
  payload: unknown
}

// ── IntelliJ → Core ──────────────────────────────────────────────
export type IntellijMessage =
  | { id: string; type: 'init';                  payload: InitPayload }
  | { id: string; type: 'user_message';          payload: { text: string; sessionId?: string; attachments?: ImageAttachment[] } }
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
  // ── 파일 검색 (멘션 기능) ──
  | { id: string; type: 'file_search';           payload: { query: string } }
  // ── IDE Action 트리거 (webview 슬래시 → IntelliJ 우클릭 메뉴와 동일 진입점) ──
  | { id: string; type: 'invoke_ide_action';     payload: { actionId: string } }
  // ── IDE-agnostic 진단 응답 (host → core, Phase 5) ──
  | { id: string; type: 'diagnostics_response';  payload: { diagnostics: Diagnostic[] } }

/** 사용자 메시지 첨부(이미지) — 멀티모달 모델일 때만 전송됨 */
export interface ImageAttachment {
  kind: 'image'
  mediaType: string   // 'image/png', 'image/jpeg' 등
  data: string        // base64 (no data: prefix)
  filename?: string
}

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
  | { id: string; type: 'turn_done';         payload: Record<string, never> }
  | { id: string; type: 'thinking_start';    payload: { iteration?: number; afterTool?: boolean } }
  | { id: string; type: 'thinking_end';      payload: { durationMs: number; content?: string } }
  | { id: string; type: 'tool_start';        payload: { tool: string; args: unknown } }
  | { id: string; type: 'tool_result';       payload: { tool: string; result: unknown } }
  // ── 자동 검증 (Auto Verifier) ──
  | { id: string; type: 'verify_start';      payload: { command: string; projectKind: string } }
  | { id: string; type: 'verify_result';     payload: { command: string; projectKind: string; passed: boolean; exitCode: number; output: string; durationMs: number; timedOut: boolean } }
  // ── IDE-agnostic 진단 (Diagnostics) — Phase 5 인터페이스 ──
  // core → host 요청, host → core 응답. host(IntelliJ/VS Code/...) 가 자체 방식으로 구현.
  | { id: string; type: 'diagnostics_request';  payload: { paths: string[] } }
  // ── IDE Action 호출 (core → host) — IntelliJ 의 ActionManager 같은 IDE 별 추상화 ──
  | { id: string; type: 'invoke_action';        payload: { actionId: string } }
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
  | { id: string; type: 'session_history';   payload: { sessionId: string; messages: SessionMessage[] } }
  // ── 연결 테스트 ──
  | { id: string; type: 'connection_test_result'; payload: { success: boolean; models?: ModelInfo[]; error?: string } }
  // ── 모델 선택 ──
  | { id: string; type: 'model_list_result'; payload: { models: ModelInfo[]; currentModel: string } }
  // model_switched 의 capabilities — webview 가 멀티모달/툴/사고 가능 여부 즉시 반영
  | { id: string; type: 'model_switched';    payload: { modelId: string; contextWindow: number; capabilities?: string[] } }
  // ── 파일 검색 (멘션 기능) ──
  | { id: string; type: 'file_search_result'; payload: { files: string[] } }

// ── 설정 (정규 정의는 settings/types.ts) ──
export type { CaptainSettings, ProviderSettings, ModelSettings } from '../settings/types.js'
import type { CaptainSettings } from '../settings/types.js'

export interface ModelInfo {
  id: string
  name: string
  contextWindow?: number
  /**
   * 모델 capability 식별자 배열 — 'completion', 'vision', 'tools', 'thinking' 등.
   * - Ollama: /api/show 응답의 capabilities + families 를 동적으로 채움
   * - Anthropic/OpenAI: 모델 이름 패턴 기반 (cloud provider 는 capability API 부재)
   * - 비어 있으면 webview 가 자체 정규식 fallback
   */
  capabilities?: string[]
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

/**
 * IDE-agnostic 진단 정보 (LSP 호환).
 * host (IntelliJ / VS Code / Neovim 등) 가 자체 방식으로 수집해 core 에 전달.
 *
 * NOTE: path/column/source 는 file 단위 응답(`diagnostics_response`) 에서 사용,
 *       FileContext.diagnostics 는 path 가 자명하므로 생략 가능.
 */
export interface Diagnostic {
  path?: string                                             // 프로젝트 루트 기준 상대 경로 (FileContext 내부에서는 생략 가능)
  line: number                                              // 1-indexed
  column?: number                                           // 1-indexed, 선택
  severity: 'error' | 'warning' | 'info' | 'hint'
  message: string
  source?: string                                           // 'tsc' / 'eslint' / 'inspection' / 'lsp:typescript' 등
}

/** UI/세션 표시용 세션 요약 정보 */
export interface SessionSummary {
  id: string
  title: string
  updatedAt: number
  messageCount: number
  preview: string
}

/** UI/세션 표시용 메시지 (providers/types.ts의 Message와 구별) */
export interface SessionMessage {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  timestamp: number
}

