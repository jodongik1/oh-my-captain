import { useState, useCallback, useRef, useEffect } from 'react'
import { sendToHost } from '../../bridge/jcef'
import { toast } from 'sonner'
import OllamaSettings from './OllamaSettings'

interface ModelInfo {
  id: string
  name: string
  contextWindow?: number
}

interface SettingsPanelProps {
  initialSettings: any // CaptainSettings type
  initialModels?: ModelInfo[]
  onClose: () => void
  onModelsUpdate?: (models: ModelInfo[]) => void
}

export interface LocalSettings {
  provider: 'ollama' | 'openai' | 'anthropic'
  ollamaBaseUrl: string
  ollamaApiKey: string
  ollamaModel: string
  openAiApiKey: string
  openAiModel: string
  openAiBaseUrl: string
  anthropicApiKey: string
  anthropicModel: string
  contextWindow: number
  requestTimeoutMs: number
}

function parseCaptainToLocal(s: any): LocalSettings {
  if (!s) return {
    provider: 'ollama',
    ollamaBaseUrl: 'http://localhost:11434',
    ollamaApiKey: '',
    ollamaModel: 'qwen3-coder:30b',
    openAiApiKey: '',
    openAiModel: 'gpt-4o',
    openAiBaseUrl: 'https://api.openai.com/v1',
    anthropicApiKey: '',
    anthropicModel: 'claude-sonnet-4-20250514',
    contextWindow: 32768,
    requestTimeoutMs: 30000,
  }
  return {
    provider: s.provider?.provider || 'ollama',
    ollamaBaseUrl: s.provider?.ollamaBaseUrl || 'http://localhost:11434',
    ollamaApiKey: s.provider?.ollamaApiKey || '',
    ollamaModel: s.provider?.ollamaModel || 'qwen3-coder:30b',
    openAiApiKey: s.provider?.openAiApiKey || '',
    openAiModel: s.provider?.openAiModel || 'gpt-4o',
    openAiBaseUrl: s.provider?.openAiBaseUrl || 'https://api.openai.com/v1',
    anthropicApiKey: s.provider?.anthropicApiKey || '',
    anthropicModel: s.provider?.anthropicModel || 'claude-sonnet-4-20250514',
    contextWindow: s.model?.contextWindow || 32768,
    requestTimeoutMs: s.model?.requestTimeoutMs || 30000,
  }
}

function buildPayload(s: LocalSettings) {
  return {
    provider: {
      provider: s.provider,
      ollamaBaseUrl: s.ollamaBaseUrl,
      ollamaApiKey: s.ollamaApiKey,
      ollamaModel: s.ollamaModel,
      openAiApiKey: s.openAiApiKey,
      openAiModel: s.openAiModel,
      openAiBaseUrl: s.openAiBaseUrl,
      anthropicApiKey: s.anthropicApiKey,
      anthropicModel: s.anthropicModel,
    },
    model: {
      contextWindow: s.contextWindow,
      requestTimeoutMs: s.requestTimeoutMs,
    }
  }
}

export default function SettingsPanel({ initialSettings, initialModels, onClose, onModelsUpdate }: SettingsPanelProps) {
  const [settings, setSettings] = useState<LocalSettings>(() => parseCaptainToLocal(initialSettings))
  const saved = useRef(settings)
  const [dirty, setDirty] = useState(false)

  const initLocal = parseCaptainToLocal(initialSettings)
  const [verifiedOllamaUrl, setVerifiedOllamaUrl] = useState(initLocal.ollamaBaseUrl)
  const [verifiedOllamaApiKey, setVerifiedOllamaApiKey] = useState(initLocal.ollamaApiKey)

  useEffect(() => {
    console.error('[REACT SettingsPanel] useEffect triggered with initialSettings:', JSON.stringify(initialSettings))
    const updated = parseCaptainToLocal(initialSettings)
    console.error('[REACT SettingsPanel] parseCaptainToLocal result:', JSON.stringify(updated))
    setSettings(updated)
    saved.current = updated
    setDirty(false)
    setVerifiedOllamaUrl(updated.ollamaBaseUrl)
    setVerifiedOllamaApiKey(updated.ollamaApiKey)
  }, [initialSettings])

  const handleChange = useCallback((patch: Record<string, unknown>) => {
    setSettings(prev => ({ ...prev, ...patch } as LocalSettings))
    setDirty(true)
  }, [])

  const handleCancel = useCallback(() => {
    setSettings({ ...saved.current })
    setDirty(false)
  }, [])

  const handleConnectionSuccess = useCallback((url: string, apiKey: string, models: ModelInfo[]) => {
    setVerifiedOllamaUrl(url)
    setVerifiedOllamaApiKey(apiKey)
    onModelsUpdate?.(models)
  }, [onModelsUpdate])

  const handleSave = useCallback(() => {
    if (settings.provider === 'ollama') {
      const urlChanged = settings.ollamaBaseUrl !== verifiedOllamaUrl
      const apiKeyChanged = settings.ollamaApiKey !== verifiedOllamaApiKey
      if (urlChanged || apiKeyChanged) {
        toast.warning('연결 테스트 성공 후 저장할 수 있습니다', { duration: 2000 })
        return
      }
    }
    // Core에 전송 (Core가 저장 처리)
    sendToHost({ type: 'settings_update', payload: buildPayload(settings) })
    saved.current = { ...settings }
    setDirty(false)
    toast.success('설정 정보를 저장하였습니다', { duration: 1000 })
    onClose()
  }, [settings, onClose, verifiedOllamaUrl, verifiedOllamaApiKey])


  // 숫자 값 clamp 유틸
  const clampNumber = (val: number, min: number, max: number) =>
    Math.max(min, Math.min(max, val))

  return (
    <div className="settings-panel">
      <div className="settings-header">
        <span>설정</span>
        <div className="settings-header-actions">
          {dirty ? (
            <>
              <button className="settings-btn cancel-btn" onClick={handleCancel}>취소</button>
              <button
                className="settings-btn save-btn active"
                onClick={handleSave}
              >
                저장
              </button>
            </>
          ) : (
            <button className="settings-btn cancel-btn" onClick={onClose}>닫기</button>
          )}
        </div>
      </div>
      <div className="settings-content">
        {/* ── Provider 선택 ── */}
        <div className="settings-group">
          <div className="settings-label">AI 모델 제공자</div>
          <select
            className="settings-select"
            value={settings.provider}
            onChange={e => handleChange({ provider: e.target.value })}
          >
            <option value="ollama">Ollama</option>
          </select>
        </div>

        {/* ── Provider별 설정 ── */}
        {settings.provider === 'ollama' && (
          <OllamaSettings
            baseUrl={settings.ollamaBaseUrl}
            apiKey={settings.ollamaApiKey}
            model={settings.ollamaModel}
            initialModels={initialModels}
            onChange={handleChange}
            onConnectionSuccess={handleConnectionSuccess}
          />
        )}

        {/* ── Common Settings (모든 Provider 공통) ── */}
        <div className="settings-divider" />

        <div className="settings-group">
          <div className="settings-label">컨텍스트 윈도우 (토큰)</div>
          <input
            className="settings-input"
            type="number"
            min={1024}
            max={2097152}
            value={settings.contextWindow}
            onChange={e => handleChange({
              contextWindow: clampNumber(Number(e.target.value), 1024, 2097152)
            })}
          />
          <div className="settings-hint">모델 컨텍스트 토큰 한도. Ollama 모델 선택 시 자동 감지됩니다.</div>
        </div>

        <div className="settings-group">
          <div className="settings-label">요청 타임아웃 (초)</div>
          <input
            className="settings-input"
            type="number"
            min={5}
            max={600}
            value={Math.round(settings.requestTimeoutMs / 1000)}
            onChange={e => handleChange({
              requestTimeoutMs: clampNumber(Number(e.target.value) * 1000, 5000, 600000)
            })}
          />
          <div className="settings-hint">요청당 최대 대기 시간. 대용량 모델은 값을 높게 설정하세요.</div>
        </div>
      </div>
    </div>
  )
}
