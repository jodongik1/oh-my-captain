// 웹뷰 ↔ Kotlin(JBCEF) 호스트 브릿지.
// - 정적 타입 계약은 ./types 의 SendType / ReceiveType 에 정의된다.
// - `IHostBridge` 인터페이스로 추상화하여 컴포넌트는 useHostBridge() 훅을 통해 주입받고,
//   테스트 시 MockBridge 로 대체 가능하다.
// - 본 파일은 기본 구현(window.__omcBridge 사용) + 모듈 레벨 fallback API 를 제공한다.

import type {
  WebviewSendMessage,
  HostInboundMessage,
  SendType,
  SendPayload,
} from './types'

// Kotlin JBCEFBridgeManager가 주입한 window.__omcBridge 래퍼
interface OmcBridge {
  onMessage: ((json: string) => void) | null
  send: (msg: unknown) => void
}

declare global {
  interface Window { __omcBridge: OmcBridge }
}

// ES 모듈 로드 순서: jcef.ts 는 main.tsx 의 console 오버라이드보다 먼저 평가되므로
// 이 시점의 console 은 원본 → fallback 출력이 자기 자신을 재귀 호출하지 않도록 캡처해 둠.
const _log = console.log.bind(console)

// ── 호스트 브릿지 추상화 ──────────────────────────────────────
export type HostMessageHandler = (msg: HostInboundMessage) => void

export interface IHostBridge {
  send<T extends SendType>(type: T, payload: SendPayload<T>): void
  /** 등록을 해제하는 unsubscribe 함수를 돌려준다. */
  onMessage(handler: HostMessageHandler): () => void
}

// ── 기본 구현: window.__omcBridge 사용 ────────────────────────
class JcefHostBridge implements IHostBridge {
  private listeners: HostMessageHandler[] = []
  private preInitQueue: WebviewSendMessage[] = []
  private bridgeReady = false

  constructor() {
    if (typeof window === 'undefined') return
    const waitForBridge = setInterval(() => {
      if (!window.__omcBridge) return
      this.bridgeReady = true

      window.__omcBridge.onMessage = (json: string) => {
        try {
          const msg = JSON.parse(json) as HostInboundMessage
          this.listeners.forEach(fn => {
            try { fn(msg) } catch (e) { _log('[bridge:handler-error]', msg.type, e) }
          })
        } catch (e) {
          _log('[bridge:parse-error]', e)
        }
      }

      while (this.preInitQueue.length > 0) {
        window.__omcBridge.send(this.preInitQueue.shift())
      }

      // 브릿지 준비 완료를 호스트에 알림 (Core 가 ready 이벤트로 부트스트랩 시작)
      this.send('ready', {})
      clearInterval(waitForBridge)
    }, 50)
  }

  send<T extends SendType>(type: T, payload: SendPayload<T>): void {
    // envelope id 는 core 의 zod 스키마(id.min(1))를 통과시키기 위해 항상 부여한다.
    // crypto.randomUUID 가 없는 옛 JCEF 환경 대비 fallback 포함.
    const id = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    const msg = { id, type, payload } as WebviewSendMessage
    if (typeof window !== 'undefined' && window.__omcBridge) {
      window.__omcBridge.send(msg)
    } else if (!this.bridgeReady) {
      this.preInitQueue.push(msg)
    } else {
      _log('[bridge:send]', msg)
    }
  }

  onMessage(handler: HostMessageHandler): () => void {
    this.listeners.push(handler)
    return () => {
      const idx = this.listeners.indexOf(handler)
      if (idx >= 0) this.listeners.splice(idx, 1)
    }
  }
}

// ── 모듈 싱글턴 + 호환 API ────────────────────────────────────
// 새 코드는 useHostBridge() 훅을 권장. 모듈 import 형태가 필요한 곳(main.tsx 의 console 오버라이드 등)
// 만 본 모듈 함수를 직접 호출한다.
export const defaultHostBridge: IHostBridge = new JcefHostBridge()

export function sendToHost<T extends SendType>(
  msg: { type: T; payload: SendPayload<T> }
): void {
  defaultHostBridge.send(msg.type, msg.payload)
}

export function onHostMessage(handler: HostMessageHandler): () => void {
  return defaultHostBridge.onMessage(handler)
}
