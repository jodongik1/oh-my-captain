// 세션 히스토리 팝업에서 사용하는 액션 모음.
// 기존에는 HistoryPopup 이 onSelect 콜백 후에 직접 bridge.send 를 호출했는데,
// 이를 본 훅이 dispatch + IPC 를 한 번에 처리하도록 통합 — 컴포넌트는 콜백만 호출.
import { useCallback } from 'react'
import type { Dispatch } from 'react'
import { useHostBridge } from '../bridge/HostBridgeContext'
import type { AppAction } from '../store'

export interface HistoryActions {
  selectSession(sessionId: string, title: string): void
  deleteSession(sessionId: string): void
  renameSession(sessionId: string, title: string): void
}

export function useHistoryActions(dispatch: Dispatch<AppAction>): HistoryActions {
  const bridge = useHostBridge()

  const selectSession = useCallback((sessionId: string, title: string) => {
    dispatch({ type: 'SELECT_SESSION', sessionId, title })
    bridge.send('session_select', { sessionId })
  }, [bridge, dispatch])

  const deleteSession = useCallback((sessionId: string) => {
    dispatch({ type: 'DELETE_SESSION', sessionId })
    bridge.send('session_delete', { sessionId })
  }, [bridge, dispatch])

  const renameSession = useCallback((sessionId: string, title: string) => {
    dispatch({ type: 'RENAME_SESSION', sessionId, title })
    bridge.send('session_rename', { sessionId, title })
  }, [bridge, dispatch])

  return { selectSession, deleteSession, renameSession }
}
