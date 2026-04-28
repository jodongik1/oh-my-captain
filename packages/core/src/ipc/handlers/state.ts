import type { IpcHostAdapter } from '../../host/ipc_adapter.js'
import type { LLMProvider, Message } from '../../providers/types.js'
import type { CaptainSettings } from '../../settings/types.js'
import { DEFAULT_SETTINGS } from '../../settings/types.js'
import { LoopController } from '../../agent/loop/controller.js'

/**
 * runLoop 진행 상태 캡슐화. busy/currentRun/loopController 의 산재 변경을 막기 위해
 * 메서드를 통해서만 상태를 바꾸도록 한다.
 *
 * - chat.ts 가 직접 busy/currentRun 을 set 하던 패턴은 beginRun() / abortAndWait() 으로 대체.
 * - codeActionController 는 chat 과 별도 라이프사이클이므로 RunState 안에 보관하되
 *   직접 노출 (cleanup 책임이 핸들러 finally 에 있기 때문).
 */
export class RunState {
  busy = false
  currentRun: Promise<void> | null = null
  readonly loopController = new LoopController()
  /** 코드 액션 전용 controller. chat runLoop 와 동시에 진행될 수 있다. */
  codeActionController: AbortController | null = null

  /**
   * runLoop 시작. busy/currentRun 마킹과 cleanup 을 한 곳에서 처리.
   * 호출자는 await 하여 종료까지 대기 가능 (직렬화 보장).
   */
  beginRun(work: () => Promise<void>): Promise<void> {
    this.busy = true
    const run = work().finally(() => {
      // 우리가 시작한 run 일 때만 정리. (이미 새 run 이 시작됐다면 그쪽이 책임짐)
      if (this.currentRun === run) {
        this.busy = false
        this.currentRun = null
      }
    })
    this.currentRun = run
    return run
  }

  /** 진행 중 runLoop 가 있으면 abort 발사 + 종료까지 대기. 빠른 연속 입력 시 race 방지. */
  async abortAndWait(): Promise<void> {
    if (this.busy && this.currentRun) {
      this.loopController.abort()
      try { await this.currentRun } catch { /* 자체 catch 처리됨 */ }
    }
  }
}

export interface CoreState {
  host: IpcHostAdapter | null
  provider: LLMProvider | null
  settings: CaptainSettings
  sessionId: string | null
  history: Message[]
  /** runLoop 진행 상태 (busy/currentRun/loopController/codeActionController) */
  run: RunState
}

export function createState(): CoreState {
  return {
    host: null,
    provider: null,
    settings: DEFAULT_SETTINGS,
    sessionId: null,
    history: [],
    run: new RunState(),
  }
}
