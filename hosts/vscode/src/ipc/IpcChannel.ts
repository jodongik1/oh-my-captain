// Core 와의 IPC 추상 인터페이스. IntelliJ 의 com.ohmycaptain.ipc.IpcChannel 와 동치.
//
// WebviewBridgeManager 는 이 인터페이스에만 의존(DIP) — 실제 stdio 구현은 IpcClient.

/**
 * IPC 메시지 타입.
 *
 * envelope 표준 키 (id/type/payload) 와 임의 추가 필드를 모두 허용한다 — 라우팅 단계에서
 * 추가 메타를 끼워 넣는 케이스가 있고, 동시에 [IpcEnvelope] 가 그대로 대입 가능해야 한다.
 */
export interface IpcMessage {
  id?: string
  type?: string
  payload?: unknown
  [key: string]: unknown
}

export interface IpcChannel {
  isConnected(): boolean
  send(message: IpcMessage): void
  startReceiving(handler: (msg: IpcMessage) => void): void
  close(): void
}
