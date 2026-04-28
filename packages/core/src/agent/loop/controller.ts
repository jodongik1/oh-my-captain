// Loop 인스턴스 생명주기 + 사용자 개입(steering/abort) 캡슐화.
// 모듈 전역 싱글톤 대신 호출자가 인스턴스를 보관 (다중 세션, 테스트 격리, race 명시화).
import { makeLogger } from '../../utils/logger.js'

const log = makeLogger('loop_controller.ts')

export class LoopController {
  private abortController: AbortController | null = null
  private steeringQueue: string[] = []

  start(): AbortSignal {
    this.abortController = new AbortController()
    return this.abortController.signal
  }

  abort(): void {
    this.abortController?.abort()
    this.abortController = null
  }

  injectSteering(text: string): void {
    log.debug('Steering inject:', text)
    this.steeringQueue.push(text)
  }

  drainSteering(): string[] {
    if (this.steeringQueue.length === 0) return []
    const items = this.steeringQueue.slice()
    this.steeringQueue.length = 0
    return items
  }
}
