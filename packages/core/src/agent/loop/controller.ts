// Loop 인스턴스 생명주기(abort) 캡슐화.
// 모듈 전역 싱글톤 대신 호출자가 인스턴스를 보관 (다중 세션, 테스트 격리, race 명시화).

export class LoopController {
  private abortController: AbortController | null = null

  start(): AbortSignal {
    this.abortController = new AbortController()
    return this.abortController.signal
  }

  abort(): void {
    this.abortController?.abort()
    this.abortController = null
  }
}
