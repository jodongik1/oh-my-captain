import { request, send } from '../ipc/server.js'
import { nanoid } from 'nanoid'
import type { HostAdapter, CoreEventMap } from './interface.js'
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

  // [흐름 6-emit] loop.ts / executeSingleTool에서 호출
  // stream_chunk, tool_start, tool_result, stream_end 등 모든 UI 이벤트를
  // ipc/server.ts의 send()를 통해 Node.js stdout → Kotlin → React로 전달
  emit<T extends keyof CoreEventMap>(type: T, payload: CoreEventMap[T]): void {
    send({ id: nanoid(), type, payload } as any)
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
