import { request, send } from '../ipc/server.js'
import { nanoid } from 'nanoid'
import type { HostAdapter } from './interface.js'
import type { FileContext, ApprovalRequest } from '../ipc/protocol.js'

export class IpcHostAdapter implements HostAdapter {
  constructor(
    private projectRoot: string,
    private mode: 'plan' | 'ask' | 'auto'
  ) {}

  getProjectRoot() { return this.projectRoot }
  getMode() { return this.mode }

  setMode(mode: 'plan' | 'ask' | 'auto') { this.mode = mode }

  async getOpenFiles(): Promise<FileContext[]> {
    return request<FileContext[]>({
      id: nanoid(),
      type: 'context_request',
      payload: { paths: [] }  // 빈 배열 = "현재 열린 파일 모두"
    })
  }

  async requestApproval(req: ApprovalRequest): Promise<boolean> {
    const result = await request<{ approved: boolean }>({
      id: nanoid(),
      type: 'approval_request',
      payload: req
    })
    return result.approved
  }

  async triggerSafetySnapshot(path: string): Promise<void> {
    send({ id: nanoid(), type: 'safety_snapshot', payload: { path } })
  }

  emit(type: string, payload: unknown): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    send({ id: nanoid(), type: type as any, payload } as any)
  }

  async getDiagnostics(path: string) {
    const files = await request<FileContext[]>({
      id: nanoid(),
      type: 'context_request',
      payload: { paths: [path] }
    })
    return files[0]?.diagnostics ?? []
  }
}
