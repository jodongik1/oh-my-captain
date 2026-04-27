import type { FileContext, ApprovalRequest, CoreMessage, Diagnostic } from '../ipc/protocol.js'

/** Core → Host 이벤트 타입 매핑 (타입 안전한 emit을 위함) */
export type CoreEventMap = {
  [K in CoreMessage['type']]: Extract<CoreMessage, { type: K }>['payload']
}

export interface HostAdapter {
  getProjectRoot(): string
  getMode(): 'plan' | 'ask' | 'auto'
  getOpenFiles(): Promise<FileContext[]>

  /**
   * IDE-agnostic 진단 정보 조회. 표준 LSP 형식의 Diagnostic[] 를 반환.
   *
   * - paths 가 비어 있으면 host 가 적절히 판단 (현재 열린 파일 또는 변경된 파일).
   * - host(IntelliJ/VS Code/...) 가 자체 방식(PSI/LSP 등)으로 구현.
   * - host 가 미구현/timeout 인 경우 빈 배열을 반환 (verifier 가 셸 검증으로 폴백).
   */
  getProjectDiagnostics(paths?: string[]): Promise<Diagnostic[]>

  requestApproval(req: ApprovalRequest): Promise<boolean>
  triggerSafetySnapshot(path: string): Promise<void>

  /**
   * IDE-agnostic action 트리거. host(IDE) 가 자기 방식으로 등록된 액션을 실행.
   * - IntelliJ: ActionManager.getAction(actionId).actionPerformed(...)
   * - VS Code:  vscode.commands.executeCommand(actionId)
   * 미구현 host 는 timeout 또는 noop. core 는 결과를 신경쓰지 않음 (액션이 자체적으로 IPC 발사).
   */
  invokeIdeAction?(actionId: string): Promise<void>

  /** 타입 안전한 이벤트 전송. CoreMessage의 type-payload 쌍을 강제합니다. */
  emit<T extends keyof CoreEventMap>(type: T, payload: CoreEventMap[T]): void
}
