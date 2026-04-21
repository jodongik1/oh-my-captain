import type { FileContext, ApprovalRequest, CoreMessage } from '../ipc/protocol.js'

/** Core → Host 이벤트 타입 매핑 (타입 안전한 emit을 위함) */
export type CoreEventMap = {
  [K in CoreMessage['type']]: Extract<CoreMessage, { type: K }>['payload']
}

export interface HostAdapter {
  getProjectRoot(): string
  getMode(): 'plan' | 'ask' | 'auto'
  getOpenFiles(): Promise<FileContext[]>
  getDiagnostics(path: string): Promise<FileContext['diagnostics']>
  requestApproval(req: ApprovalRequest): Promise<boolean>
  triggerSafetySnapshot(path: string): Promise<void>

  /** 타입 안전한 이벤트 전송. CoreMessage의 type-payload 쌍을 강제합니다. */
  emit<T extends keyof CoreEventMap>(type: T, payload: CoreEventMap[T]): void
}
