import { useEffect, useRef } from 'react'
import type { Dispatch } from 'react'
import { onHostMessage } from '../jcef'
import type { AppAction } from '../../store'
import { createIpcHandlers } from './handlers'

// [흐름 7] Core → Kotlin → Bridge → React 메시지 수신을 타입별 핸들러로 라우팅.
// currentSource(stream_start → stream_chunk)는 useRef로 effect 간 공유.
export function useIpcMessageHandler(dispatch: Dispatch<AppAction>) {
  const sourceRef = useRef<'chat' | 'action'>('chat')

  useEffect(() => {
    const handlers = createIpcHandlers({ dispatch, sourceRef })
    return onHostMessage((msg) => {
      handlers[msg.type]?.(msg.payload)
    })
  }, [dispatch])
}
