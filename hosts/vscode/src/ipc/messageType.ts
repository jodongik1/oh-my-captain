// IntelliJ 측 com.ohmycaptain.ipc.IpcMessageType 와 1:1 동기화된 IPC 메시지 타입 상수.
//
// Core 측 코드(@omc/protocol)의 type 필드와도 어긋나면 silent drop 되므로 같이 갱신해야 한다.
// 새 타입 추가 시 IntelliJ 의 IpcMessageType.kt 와 함께 수정.

export const IpcMessageType = {
  // ── Webview → Core ──────────────────────────────────────────────
  INIT: 'init',
  CODE_ACTION: 'code_action',
  APPROVAL_RESPONSE: 'approval_response',
  CONTEXT_RESPONSE: 'context_response',

  // ── Core → Host ─────────────────────────────────────────────────
  CONTEXT_REQUEST: 'context_request',
  APPROVAL_REQUEST: 'approval_request',
  INVOKE_ACTION: 'invoke_action',

  // ── 양방향 ───────────────────────────────────────────────────────
  OPEN_IN_EDITOR: 'open_in_editor',
  OPEN_TOOL_OUTPUT: 'open_tool_output',

  // ── Host → Webview 전용 ──────────────────────────────────────────
  CORE_READY: 'core_ready',
  READY: 'ready',
  ERROR: 'error',
} as const

export type IpcMessageTypeValue = (typeof IpcMessageType)[keyof typeof IpcMessageType]
