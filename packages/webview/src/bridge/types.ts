// 웹뷰 ↔ 호스트(IntelliJ) IPC 의 정적 타입 계약.
// `@omc/protocol` 의 IntellijMessage / CoreMessage 위에 webview 고유 채널을 얹은 단일 사실 출처.
// 모든 sendToHost / 핸들러 등록은 본 파일의 타입만 참조해야 하며, payload: unknown 캐스팅을 차단.

import type {
  IntellijMessage,
  CoreMessage,
  IntellijPayloadOf,
  CorePayloadOf,
} from '@omc/protocol'

// ── Webview → Host (IntelliJ) ──────────────────────────────────
// IntelliJ 호스트가 받는 메시지 = IntellijMessage 전부 + webview 전용 보조 채널.
// `open_in_editor` 는 protocol 상 Core → Host 이지만 webview 도 같은 호스트 핸들러로 보낸다.
// `client_log` 는 webview → Core 디버깅 채널 (호스트가 그대로 stdin 으로 릴레이).
// `approval_response` 는 host 어댑터(ApprovalEnvelopeAdapter)가 payload.requestId 를 envelope.id 로
//  승격하므로 webview 는 protocol 보다 한 필드(`requestId`) 더 보낸다.
export type WebviewExtraSend =
  | { id?: string; type: 'open_in_editor';     payload: { path: string; line?: number } }
  | { id?: string; type: 'open_tool_output';   payload: { title: string; content: string } }
  | { id?: string; type: 'client_log';         payload: { level: 'debug' | 'info' | 'warn' | 'error'; message: string } }
  | { id?: string; type: 'approval_response';  payload: { requestId: string; approved: boolean } }
  | { id?: string; type: 'ready';              payload: Record<string, never> }

/** webview 가 직접 사용하지 않는 IntellijMessage 타입(예: `approval_response`)은 override 한다. */
type WebviewSendOverride = WebviewExtraSend['type']

export type WebviewSendMessage =
  | (Omit<Extract<IntellijMessage, { type: Exclude<IntellijMessage['type'], WebviewSendOverride> }>, 'id'> & { id?: string })
  | WebviewExtraSend

export type SendType =
  | Exclude<IntellijMessage['type'], WebviewSendOverride>
  | WebviewExtraSend['type']

export type SendPayload<T extends SendType> =
  T extends WebviewExtraSend['type'] ? Extract<WebviewExtraSend, { type: T }>['payload']
  : T extends IntellijMessage['type'] ? IntellijPayloadOf<T>
  : never

// ── Host (IntelliJ) → Webview ──────────────────────────────────
// Core 가 보내는 모든 이벤트 + 호스트가 자체적으로 주입하는 라이프사이클 이벤트.
// `core_ready` 는 IntelliJ host 의 IpcMessageType.CORE_READY (Core 프로세스 준비 완료 신호).
// `approval_request` 는 host 의 ApprovalEnvelopeAdapter 가 envelope.id 를 payload.id 로 enrich 하므로
//  protocol 보다 한 필드(`id`) 더 받는다.
export type WebviewExtraReceive =
  | { type: 'core_ready';        payload: Record<string, never> }
  | { type: 'approval_request';  payload: CorePayloadOf<'approval_request'> & { id: string } }

type WebviewReceiveOverride = WebviewExtraReceive['type']

export type ReceiveType =
  | Exclude<CoreMessage['type'], WebviewReceiveOverride>
  | WebviewExtraReceive['type']

export type ReceivePayload<T extends ReceiveType> =
  T extends WebviewExtraReceive['type'] ? Extract<WebviewExtraReceive, { type: T }>['payload']
  : T extends CoreMessage['type'] ? CorePayloadOf<T>
  : never

/** 호스트로부터 도착한 메시지 봉투 — id 는 envelope 메타이며 핸들러는 payload 만 받는다. */
export interface HostInboundMessage {
  type: ReceiveType | string
  payload: unknown
}
