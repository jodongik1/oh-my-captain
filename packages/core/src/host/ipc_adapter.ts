import { request, send } from '../ipc/server.js'
import { nanoid } from 'nanoid'
import type { HostAdapter, CoreEventMap } from './interface.js'
import type { FileContext, ApprovalRequest, Diagnostic, CoreMessage } from '@omc/protocol'
import { makeLogger } from '../utils/logger.js'

const log = makeLogger('ipc_adapter.ts')

/** 진단 요청 timeout — host 가 미구현이거나 느린 경우 폴백을 위해 짧게 잡음 */
const DIAGNOSTICS_TIMEOUT_MS = 3_000

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
    // Extract 로 좁힌 단언은 discriminated union 의 정확한 한 변형을 가리킨다 (as any 회피).
    send({ id: nanoid(), type, payload } as Extract<CoreMessage, { type: T }>)
  }

  /**
   * IDE 측 등록된 action 을 트리거. fire-and-forget — host 가 응답을 보내지 않아도 됨.
   * 액션 자체가 PSI/언어 컨텍스트를 수집해 별도 IPC(code_action 등) 로 진행하므로
   * 여기서는 명령 전송만 책임진다.
   */
  async invokeIdeAction(actionId: string): Promise<void> {
    send({ id: nanoid(), type: 'invoke_action', payload: { actionId } })
  }

  /**
   * host 측 진단(IntelliJ Inspection / VS Code LSP / 기타 LSP client) 을 IPC 로 요청.
   * timeout 이 발생하거나 host 가 미구현이면 빈 배열을 반환해 호출자가 폴백할 수 있게 한다.
   */
  async getProjectDiagnostics(paths?: string[]): Promise<Diagnostic[]> {
    try {
      const result = await Promise.race([
        request<{ diagnostics: Diagnostic[] }>({
          id: nanoid(),
          type: 'diagnostics_request',
          payload: { paths: paths ?? [] }
        }),
        new Promise<{ diagnostics: Diagnostic[] }>((_, reject) =>
          setTimeout(() => reject(new Error('diagnostics_timeout')), DIAGNOSTICS_TIMEOUT_MS)
        ),
      ])
      return result?.diagnostics ?? []
    } catch (e) {
      log.debug(`getProjectDiagnostics 미응답/실패 — 빈 배열 반환 (${(e as Error).message})`)
      return []
    }
  }
}
