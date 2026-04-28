import { useEffect, useRef } from 'react'
import type { Dispatch } from 'react'
import { useHostBridge } from '../HostBridgeContext'
import type { AppAction } from '../../store'
import { createIpcHandlers } from './handlers'
import type { IpcHandler, IpcHandlerMap } from './types'
import type { ReceiveType } from '../types'

// [흐름 7] Core → Kotlin → Bridge → React 메시지 수신을 타입별 핸들러로 라우팅.
// stream_start ~ stream_chunk 사이의 source 는 useRef 로 effect 간 공유.
export function useIpcMessageHandler(dispatch: Dispatch<AppAction>) {
  const sourceRef = useRef<'chat' | 'action'>('chat')
  const bridge = useHostBridge()

  useEffect(() => {
    const handlers = createIpcHandlers({ dispatch, sourceRef, bridge })
    return bridge.onMessage((msg) => {
      const handler = handlers[msg.type as ReceiveType] as IpcHandler<ReceiveType> | undefined
      if (!handler) {
        // 미처리 메시지는 silently drop — 신규 protocol 이벤트가 webview 보다 먼저 배포돼도 깨지지 않도록.
        return
      }
      try {
        handler(msg.payload as never)
      } catch (e) {
        // 핸들러 예외가 React 트리를 죽이지 않도록 격리
        // eslint-disable-next-line no-console
        console.error(`[ipc:${msg.type}] handler error:`, e)
      }
    })
  }, [dispatch, bridge])
}

// 외부에서 핸들러 맵 자체가 필요할 때를 위해 재노출.
export type { IpcHandlerMap }
