// Kotlin JBCEFBridgeManager가 주입한 window.__omcBridge 래퍼

interface OmcBridge {
  onMessage: ((json: string) => void) | null
  send: (msg: unknown) => void
}

declare global {
  interface Window { __omcBridge: OmcBridge }
}

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

// React → Kotlin 메시지 전송
export function sendToHost(msg: { type: string; payload: unknown }): void {
  if (typeof window !== 'undefined' && window.__omcBridge) {
    window.__omcBridge.send(msg)
  } else {
    // 개발 모드 (Vite dev server): 콘솔에만 출력
    console.log('[bridge:send]', msg)
  }
}

// 초기화: Kotlin이 주입한 onMessage 콜백 연결
if (typeof window !== 'undefined') {
  const waitForBridge = setInterval(() => {
    if (window.__omcBridge) {
      window.__omcBridge.onMessage = (json: string) => {
        try {
          const msg = JSON.parse(json) as { type: string; payload: unknown }
          listeners.forEach(fn => fn(msg))
        } catch (e) {
          console.error('Bridge parse error:', e)
        }
      }
      // React 쪽 브릿지가 준비되었음을 Kotlin에 알림
      sendToHost({ type: 'ready', payload: {} })
      clearInterval(waitForBridge)
    }
  }, 50)
}
