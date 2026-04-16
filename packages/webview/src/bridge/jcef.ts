// Kotlin JBCEFBridgeManager가 주입한 window.__omcBridge 래퍼

interface OmcBridge {
  onMessage: ((json: string) => void) | null
  send: (msg: unknown) => void
}

declare global {
  interface Window { __omcBridge: OmcBridge }
}

// ES 모듈 로드 순서: jcef.ts는 main.tsx의 console 오버라이드보다 먼저 실행됨
// 따라서 이 시점의 console은 원본 → sendToHost 내 fallback에서 재귀 방지를 위해 캡처
const _log = console.log.bind(console)

// 브릿지 준비 전에 sendToHost로 들어온 메시지를 임시 보관
const preInitQueue: Array<{ type: string; payload: unknown }> = []
let bridgeReady = false

type MessageHandler = (msg: { type: string; payload: unknown }) => void
const listeners: MessageHandler[] = []

// Kotlin → React 메시지 수신 등록
export function onHostMessage(handler: MessageHandler): () => void {
  listeners.push(handler)
  return () => {
    const idx = listeners.indexOf(handler)
    if (idx >= 0) listeners.splice(idx, 1)
  }
}

// [흐름 3] React → Kotlin 메시지 전송
// Kotlin의 JBCEFBridgeManager가 이 메시지를 수신 후 Node.js stdin으로 NDJSON 전달
export function sendToHost(msg: { type: string; payload: unknown }): void {
  if (typeof window !== 'undefined' && window.__omcBridge) {
    window.__omcBridge.send(msg)
  } else if (!bridgeReady) {
    // 브릿지 준비 전: 큐에 보관했다가 연결 시 flush
    preInitQueue.push(msg)
  } else {
    // 개발 모드 (Vite dev server): 원본 console 사용 (오버라이드된 것 아님 → 재귀 방지)
    _log('[bridge:send]', msg)
  }
}

// [흐름 7-초기화] Kotlin이 주입한 onMessage 콜백을 연결
// Kotlin은 Node.js stdout에서 받은 NDJSON을 이 콜백으로 React에 전달
if (typeof window !== 'undefined') {
  const waitForBridge = setInterval(() => {
    if (window.__omcBridge) {
      bridgeReady = true

      // window.__omcBridge.onMessage: Kotlin이 React로 메시지를 밀어넣는 진입점
      window.__omcBridge.onMessage = (json: string) => {
        try {
          const msg = JSON.parse(json) as { type: string; payload: unknown }
          // 등록된 모든 핸들러(App.tsx의 onHostMessage 등)에 브로드캐스트
          listeners.forEach(fn => fn(msg))
        } catch (e) {
          console.error('Bridge parse error:', e)
        }
      }

      // 브릿지 준비 전에 쌓인 로그를 순서대로 전송
      while (preInitQueue.length > 0) {
        window.__omcBridge.send(preInitQueue.shift()!)
      }

      // React 쪽 브릿지가 준비되었음을 Kotlin에 알림
      sendToHost({ type: 'ready', payload: {} })
      clearInterval(waitForBridge)
    }
  }, 50)
}
