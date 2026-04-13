import { useState, useEffect, useCallback } from 'react'
import { sendToHost, onHostMessage } from '../../bridge/jcef'

interface OllamaSettingsProps {
  baseUrl: string
  apiKey: string
  model: string
  onChange: (patch: Record<string, unknown>) => void
}

interface ModelInfo {
  id: string
  name: string
  contextWindow?: number
}

export default function OllamaSettings({
  baseUrl, apiKey, model, onChange
}: OllamaSettingsProps) {
  const [useCustomUrl, setUseCustomUrl] = useState(baseUrl !== 'http://localhost:11434')
  const [showKey, setShowKey] = useState(false)
  const [connStatus, setConnStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle')
  const [connError, setConnError] = useState('')
  const [models, setModels] = useState<ModelInfo[]>([])

  // Core에서 connection_test_result 수신
  useEffect(() => {
    return onHostMessage((msg) => {
      if (msg.type === 'connection_test_result') {
        const p = msg.payload as { success: boolean; models?: ModelInfo[]; error?: string }
        if (p.success) {
          setConnStatus('ok')
          setConnError('')
          if (p.models) setModels(p.models)
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
  }, [])

  const testConnection = useCallback(() => {
    setConnStatus('testing')
    setConnError('')
    sendToHost({
      type: 'connection_test',
      payload: {
        baseUrl: useCustomUrl ? baseUrl : 'http://localhost:11434',
        apiKey: apiKey || undefined
      }
    })
  }, [baseUrl, apiKey, useCustomUrl])

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
      <label className="settings-checkbox">
        <input
          type="checkbox"
          checked={useCustomUrl}
          onChange={e => {
            setUseCustomUrl(e.target.checked)
            if (!e.target.checked) onChange({ ollamaBaseUrl: 'http://localhost:11434' })
            setModels([])
            setConnStatus('idle')
          }}
        />
        Use custom base URL
      </label>

      {useCustomUrl && (
        <div className="settings-group">
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
      )}

      {/* API Key */}
      <div className="settings-group">
        <div className="settings-label">API Key</div>
        <div className="settings-row">
          <input
            className="settings-input"
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            placeholder="Leave empty for local installation"
            onChange={e => onChange({ ollamaApiKey: e.target.value })}
          />
          <button className="settings-btn" onClick={() => setShowKey(!showKey)}>
            {showKey ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>

      {/* Connection Test — URL/Key 바로 아래 배치 */}
      <div className="settings-group" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          className="settings-btn test-btn"
          onClick={testConnection}
          disabled={connStatus === 'testing'}
        >
          {connStatus === 'testing' ? 'Testing...' : '🔌 Test Connection'}
        </button>
        {connStatus === 'ok' && <span className="connection-status success">✓ Connected ({models.length} models)</span>}
        {connStatus === 'error' && <span className="connection-status error">✗ {connError}</span>}
      </div>

      {/* Model */}
      <div className="settings-group">
        <div className="settings-label">Model</div>
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
                {m.name}{m.contextWindow ? ` (${(m.contextWindow / 1024).toFixed(0)}K)` : ''}
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
          <div className="settings-hint">Run Test Connection to load available models.</div>
        )}
      </div>
    </div>
  )
}
