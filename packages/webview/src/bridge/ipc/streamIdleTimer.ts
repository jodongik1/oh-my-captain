// 스트리밍 idle 감지: 마지막 토큰 이후 일정 시간 새 토큰이 없으면
// status 표시줄을 다시 띄워 "출력이 잠시 멈춤" 을 사용자에게 알린다.

import type { Dispatch } from 'react'
import type { AppAction } from '../../store'

export const STREAM_IDLE_THRESHOLD_MS = 3000

export interface StreamIdleTimer {
  arm(): void
  clear(): void
}

export function createStreamIdleTimer(dispatch: Dispatch<AppAction>): StreamIdleTimer {
  let id: ReturnType<typeof setTimeout> | null = null
  const clear = () => {
    if (id !== null) { clearTimeout(id); id = null }
  }
  return {
    clear,
    arm() {
      clear()
      id = setTimeout(() => {
        dispatch({
          type: 'SET_ACTIVITY',
          activity: { type: 'streaming', label: '응답 대기 중', startedAt: Date.now() },
        })
        id = null
      }, STREAM_IDLE_THRESHOLD_MS)
    },
  }
}
