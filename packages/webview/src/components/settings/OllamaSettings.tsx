import { useState, useEffect, useCallback, useRef } from 'react'
import { useHostBridge } from '../../bridge/HostBridgeContext'
import { useSettingsActions } from '../../hooks/useSettingsActions'
import type { LocalSettings } from './SettingsPanel'

interface OllamaSettingsProps {
  baseUrl: string
  apiKey: string
  model: string
  initialModels?: ModelInfo[]
  onChange: (patch: Partial<LocalSettings>) => void
  onConnectionSuccess?: (url: string, apiKey: string, models: ModelInfo[]) => void
}

interface ModelInfo {
  id: string
  name: string
  contextWindow?: number
}

export default function OllamaSettings({
  baseUrl, apiKey, model, initialModels, onChange, onConnectionSuccess
}: OllamaSettingsProps) {
  const bridge = useHostBridge()
  const settingsActions = useSettingsActions()
  const [connStatus, setConnStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle')
  const [connError, setConnError] = useState('')
  const [models, setModels] = useState<ModelInfo[]>(initialModels ?? [])
  const testingUrl = useRef(baseUrl)
  const testingApiKey = useRef(apiKey)

  // Core 에서 connection_test_result / model_list_result 수신.
  // bridge.onMessage 의 inbound 타입은 ReceiveType 이며, 본 컴포넌트가 알아야 하는 두 타입만 분기.
  useEffect(() => {
    return bridge.onMessage((msg) => {
      if (msg.type === 'connection_test_result') {
        const p = msg.payload as { success: boolean; models?: ModelInfo[]; error?: string }
        if (p.success) {
          const fetchedModels = p.models ?? []
          setConnStatus('ok')
          setConnError('')
          setModels(fetchedModels)
          onConnectionSuccess?.(testingUrl.current, testingApiKey.current, fetchedModels)
        } else {
          setConnStatus('error')
          setConnError(p.error || 'Connection failed')
        }
      }
      if (msg.type === 'model_list_result') {
        const p = msg.payload as { models: ModelInfo[] }
        setModels(p.models || [])
      }
    })
  }, [bridge, onConnectionSuccess])

  const testConnection = useCallback(() => {
    setConnStatus('testing')
    setConnError('')
    testingUrl.current = baseUrl
    testingApiKey.current = apiKey
    settingsActions.testConnection(baseUrl, apiKey)
  }, [settingsActions, baseUrl, apiKey])

  const handleModelSelect = useCallback((modelId: string) => {
    onChange({ ollamaModel: modelId })
    const selected = models.find(m => m.id === modelId)
    if (selected?.contextWindow) {
      onChange({ ollamaModel: modelId, contextWindow: selected.contextWindow })
    }
  }, [models, onChange])

  return (
    <div>
      {/* Custom URL */}
      <div className="settings-group">
        <div className="settings-label">URL</div>
        <input
          className="settings-input"
          value={baseUrl}
          placeholder="http://localhost:11434"
          onChange={e => {
            onChange({ ollamaBaseUrl: e.target.value })
            setConnStatus('idle')
            setModels([])
          }}
        />
      </div>

      {/* API Key */}
      <div className="settings-group">
        <div className="settings-label">API 키</div>
        <input
          className="settings-input"
          type="password"
          value={apiKey}
          placeholder="로컬 설치의 경우 비워두세요"
          onChange={e => onChange({ ollamaApiKey: e.target.value })}
        />
      </div>

      {/* Connection Test — URL/Key 바로 아래 배치 */}
      <div className="settings-group" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          className="settings-btn test-btn"
          onClick={testConnection}
          disabled={connStatus === 'testing'}
        >
          {connStatus === 'testing' ? '연결 중...' : '🔌 연결 테스트'}
        </button>
        {connStatus === 'ok' && <span className="connection-status success">✓ 연결됨 ({models.length}개 모델)</span>}
        {connStatus === 'error' && <span className="connection-status error">✗ {connError}</span>}
      </div>

      {/* Model */}
      <div className="settings-group">
        <div className="settings-label">모델</div>
        {models.length > 0 ? (
          <select
            className="settings-select"
            value={model}
            onChange={e => handleModelSelect(e.target.value)}
          >
            {!models.find(m => m.id === model) && (
              <option value={model}>{model}</option>
            )}
            {models.map(m => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        ) : (
          <input
            className="settings-input"
            value={model}
            placeholder="qwen3-coder:30b"
            onChange={e => onChange({ ollamaModel: e.target.value })}
          />
        )}
        {models.length === 0 && (
          <div className="settings-hint">연결 테스트를 실행하면 사용 가능한 모델 목록이 표시됩니다.</div>
        )}
      </div>
    </div>
  )
}
