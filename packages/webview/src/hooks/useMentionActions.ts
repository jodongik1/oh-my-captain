// `@` 멘션 자동완성에서 호스트로 file_search 요청을 보내는 IPC 액션.
import { useCallback } from 'react'
import { useHostBridge } from '../bridge/HostBridgeContext'

export interface MentionActions {
  /** 빈 문자열을 보내면 최근 파일 / 디렉토리 기본 목록을 반환받는다. */
  searchFiles(query: string): void
}

export function useMentionActions(): MentionActions {
  const bridge = useHostBridge()
  const searchFiles = useCallback((query: string) => {
    bridge.send('file_search', { query })
  }, [bridge])
  return { searchFiles }
}
