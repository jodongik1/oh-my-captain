// Wire protocol — core ↔ host(IntelliJ) ↔ webview 사이의 단일 타입 소스.
// 모든 IPC 메시지/페이로드/설정 타입은 여기서만 정의하고 양 패키지가 import 한다.
//
// 분리 가이드:
//  - 본 파일에는 **타입(인터페이스/유니온)** 만 둔다.
//  - 기본값이나 런타임 로직은 각 패키지 (core/settings 등) 에서 정의한다.

// ── 설정 ────────────────────────────────────────────────────────
// 타입 + zod 스키마 + DEFAULT_SETTINGS 의 단일 소스. ./settings 참고.
export {
  apiProviderSchema,
  providerSettingsSchema,
  modelSettingsSchema,
  cachedModelInfoSchema,
  captainSettingsSchema,
  DEFAULT_SETTINGS,
} from './settings.js'
export type {
  ApiProvider,
  ProviderSettings,
  ModelSettings,
  CachedModelInfo,
  CaptainSettings,
} from './settings.js'

import type { CaptainSettings } from './settings.js'

// ── IPC 봉투 ────────────────────────────────────────────────────
export interface IPCMessage {
  /** nanoid — 요청-응답 상관관계 추적용 */
  id: string
  type: string
  payload: unknown
}

// ── 공통 페이로드 타입 ─────────────────────────────────────────
/** 사용자 메시지 첨부 (이미지) — 멀티모달 모델일 때만 전송 */
export interface ImageAttachment {
  kind: 'image'
  mediaType: string   // 'image/png', 'image/jpeg' 등
  data: string        // base64 (no data: prefix)
  filename?: string
}

export interface InitPayload {
  projectRoot: string
  nodeVersion: string
  mode: 'plan' | 'ask' | 'auto'
}

export interface ModelInfo {
  id: string
  name: string
  contextWindow?: number
  /** 'completion' | 'vision' | 'tools' | 'thinking' 등 — provider 가 동적으로 채움 */
  capabilities?: string[]
}

export type CodeActionType =
  | 'explain' | 'review' | 'impact' | 'query_validation' | 'improve' | 'generate_test'

export interface CodeActionPayload {
  action: CodeActionType
  code: string
  filePath: string
  language: string
  lineRange?: { start: number; end: number }
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
  symbols: SymbolInfo[]
  imports: string[]
  diagnostics: Diagnostic[]
}

export interface SymbolInfo {
  kind: 'class' | 'function' | 'variable' | 'interface' | 'type'
  name: string
  line: number
}

/**
 * IDE-agnostic 진단 (LSP 호환).
 * host(IntelliJ/VS Code/...) 가 자체 방식으로 수집해 core 에 전달.
 */
export interface Diagnostic {
  /** 프로젝트 루트 기준 상대 경로 (FileContext 내부에서는 생략 가능) */
  path?: string
  line: number          // 1-indexed
  column?: number       // 1-indexed
  severity: 'error' | 'warning' | 'info' | 'hint'
  message: string
  source?: string       // 'tsc' / 'eslint' / 'inspection' / 'lsp:typescript' 등
}

export interface SessionSummary {
  id: string
  title: string
  updatedAt: number
  messageCount: number
  preview: string
}

export interface SessionMessage {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  timestamp: number
}

// ── IntelliJ → Core ────────────────────────────────────────────
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
  | { id: string; type: 'session_select';        payload: { sessionId: string } }
  | { id: string; type: 'session_list';          payload: Record<string, never> }
  | { id: string; type: 'session_new';           payload: Record<string, never> }
  | { id: string; type: 'session_delete';        payload: { sessionId: string } }
  | { id: string; type: 'session_rename';        payload: { sessionId: string; title: string } }
  | { id: string; type: 'model_list';            payload: Record<string, never> }
  | { id: string; type: 'model_switch';          payload: { modelId: string } }
  | { id: string; type: 'connection_test';       payload: { baseUrl: string; apiKey?: string } }
  | { id: string; type: 'code_action';           payload: CodeActionPayload }
  | { id: string; type: 'steer_inject';          payload: { text: string } }
  | { id: string; type: 'steer_interrupt';       payload: Record<string, never> }
  | { id: string; type: 'file_search';           payload: { query: string } }
  | { id: string; type: 'invoke_ide_action';     payload: { actionId: string } }
  | { id: string; type: 'diagnostics_response';  payload: { diagnostics: Diagnostic[] } }
  | { id: string; type: 'client_log';            payload: { level: string; message: string } }

// ── Core → IntelliJ ────────────────────────────────────────────
export type CoreMessage =
  | { id: string; type: 'ready';                  payload: Record<string, never> }
  | { id: string; type: 'context_request';        payload: { paths: string[] } }
  | { id: string; type: 'approval_request';       payload: ApprovalRequest }
  | { id: string; type: 'safety_snapshot';        payload: { path: string } }
  | { id: string; type: 'stream_start';           payload: { source: 'chat' | 'action' } }
  | { id: string; type: 'stream_chunk';           payload: { token: string } }
  | { id: string; type: 'stream_end';             payload: Record<string, never> }
  | { id: string; type: 'turn_done';              payload: Record<string, never> }
  | { id: string; type: 'thinking_start';         payload: { iteration?: number; afterTool?: boolean } }
  | { id: string; type: 'thinking_end';           payload: { durationMs: number; content?: string } }
  | { id: string; type: 'tool_start';             payload: { tool: string; args: unknown } }
  | { id: string; type: 'tool_result';            payload: { tool: string; result: unknown } }
  | { id: string; type: 'verify_start';           payload: { command: string; projectKind: string } }
  | { id: string; type: 'verify_result';          payload: VerifyResultPayload }
  | { id: string; type: 'diagnostics_request';    payload: { paths: string[] } }
  | { id: string; type: 'invoke_action';          payload: { actionId: string } }
  | { id: string; type: 'open_in_editor';         payload: { path: string; line?: number } }
  | { id: string; type: 'error';                  payload: { message: string; retryable: boolean } }
  | { id: string; type: 'context_usage';          payload: { usedTokens: number; maxTokens: number; percentage: number } }
  | { id: string; type: 'compaction';             payload: { stage: 'budget' | 'snip' | 'microcompact' | 'collapse' | 'auto' | 'none'; beforeTokens: number; afterTokens: number } }
  | { id: string; type: 'eval_result';            payload: { verdict: 'on_track' | 'drift' | 'stuck' | 'done'; rationale: string; suggestion?: string; iteration: number } }
  | { id: string; type: 'permission_denied';      payload: { tool: string; reason: string; mode: string } }
  | { id: string; type: 'settings_loaded';        payload: { settings: CaptainSettings; isFirstTime: boolean } }
  | { id: string; type: 'models_list';            payload: { models: string[] } }
  | { id: string; type: 'sessions_list';          payload: { sessions: SessionSummary[] } }
  | { id: string; type: 'session_history';        payload: { sessionId: string; messages: SessionMessage[] } }
  | { id: string; type: 'connection_test_result'; payload: { success: boolean; models?: ModelInfo[]; error?: string } }
  | { id: string; type: 'model_list_result';      payload: { models: ModelInfo[]; currentModel: string } }
  | { id: string; type: 'model_switched';         payload: { modelId: string; contextWindow: number; capabilities?: string[] } }
  | { id: string; type: 'file_search_result';     payload: { files: string[] } }

export interface VerifyResultPayload {
  command: string
  projectKind: string
  passed: boolean
  exitCode: number
  output: string
  durationMs: number
  timedOut: boolean
  /**
   * 실패 원인 분류 (passed=false 일 때만 의미 있음).
   * - 'code': 코드 변경 결과의 빌드/타입/테스트 실패
   * - 'env':  빌드 환경 문제 (pom 손상, 도구 미설치, 네트워크 등) — LLM 자가수정 대상이 아님
   */
  failureKind?: 'code' | 'env'
}

// ── 디스크리미네이트 헬퍼 ──────────────────────────────────────
/** core → host 메시지에서 type 으로 payload 를 정확히 추출 */
export type CorePayloadOf<T extends CoreMessage['type']> =
  Extract<CoreMessage, { type: T }>['payload']

/** host → core 메시지에서 type 으로 payload 를 정확히 추출 */
export type IntellijPayloadOf<T extends IntellijMessage['type']> =
  Extract<IntellijMessage, { type: T }>['payload']
