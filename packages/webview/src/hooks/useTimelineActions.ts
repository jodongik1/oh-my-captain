// 타임라인 행에서 호스트(IDE) 로 전송하는 IPC 액션. 컴포넌트가 bridge.send 를 직접
// 호출하던 의존성 누설을 한 곳에 모은다.
import { useCallback } from 'react'
import { useHostBridge } from '../bridge/HostBridgeContext'

export interface TimelineActions {
  /** 파일을 IDE 에디터에서 연다. line 이 주어지면 해당 위치로 점프. */
  openInEditor(path: string, line?: number): void
  /** 도구 출력을 IDE 새 탭으로 연다. */
  openToolOutput(title: string, content: string): void
}

export function useTimelineActions(): TimelineActions {
  const bridge = useHostBridge()

  const openInEditor = useCallback((path: string, line?: number) => {
    bridge.send('open_in_editor', { path, line })
  }, [bridge])

  const openToolOutput = useCallback((title: string, content: string) => {
    bridge.send('open_tool_output', { title, content })
  }, [bridge])

  return { openInEditor, openToolOutput }
}
