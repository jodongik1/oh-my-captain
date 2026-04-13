import type { FileContext, ApprovalRequest } from '../ipc/protocol.js'

export interface HostAdapter {
  getProjectRoot(): string
  getMode(): 'plan' | 'ask' | 'auto'
  getOpenFiles(): Promise<FileContext[]>
  getDiagnostics(path: string): Promise<FileContext['diagnostics']>
  requestApproval(req: ApprovalRequest): Promise<boolean>
  triggerSafetySnapshot(path: string): Promise<void>
  emit(type: string, payload: unknown): void
}
