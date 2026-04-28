// SettingsPanel / OllamaSettings 가 사용하는 IPC 액션 묶음.
import { useCallback } from 'react'
import type { CaptainSettings } from '@omc/protocol'
import { useHostBridge } from '../bridge/HostBridgeContext'

export interface SettingsActions {
  /** 사용자가 저장 버튼을 눌렀을 때 — 코어가 디스크 저장 + provider 재생성 처리. */
  save(settings: CaptainSettings): void
  /** Ollama 연결 테스트 — 결과는 connection_test_result 로 비동기 도착. */
  testConnection(baseUrl: string, apiKey?: string): void
}

export function useSettingsActions(): SettingsActions {
  const bridge = useHostBridge()

  const save = useCallback((settings: CaptainSettings) => {
    bridge.send('settings_update', settings)
  }, [bridge])

  const testConnection = useCallback((baseUrl: string, apiKey?: string) => {
    bridge.send('connection_test', { baseUrl, apiKey: apiKey || undefined })
  }, [bridge])

  return { save, testConnection }
}
