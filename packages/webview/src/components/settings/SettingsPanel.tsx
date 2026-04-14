import { useState, useCallback, useRef, useEffect } from 'react'
import { sendToHost } from '../../bridge/jcef'
import OllamaSettings from './OllamaSettings'

interface SettingsPanelProps {
  initialSettings: any // CaptainSettings type
  onClose: () => void
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

/** API Key 입력 + 표시/숨김 토글 */
function ApiKeyField({
  value,
  placeholder,
  onChange,
}: {
  value: string
  placeholder: string
  onChange: (v: string) => void
}) {
  const [showKey, setShowKey] = useState(false)
  return (
    <div className="settings-row">
      <input
        className="settings-input"
        type={showKey ? 'text' : 'password'}
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
      />
      <button className="settings-btn" onClick={() => setShowKey(!showKey)}>
        {showKey ? '숨기기' : '표시'}
      </button>
    </div>
  )
}

export default function SettingsPanel({ initialSettings, onClose }: SettingsPanelProps) {
  const [settings, setSettings] = useState<LocalSettings>(() => parseCaptainToLocal(initialSettings))
  const saved = useRef(settings)
  const [dirty, setDirty] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved'>('idle')

  useEffect(() => {
    console.error('[REACT SettingsPanel] useEffect triggered with initialSettings:', JSON.stringify(initialSettings))
    const updated = parseCaptainToLocal(initialSettings)
    console.error('[REACT SettingsPanel] parseCaptainToLocal result:', JSON.stringify(updated))
    setSettings(updated)
    saved.current = updated
    setDirty(false)
  }, [initialSettings])

  const handleChange = useCallback((patch: Record<string, unknown>) => {
    setSettings(prev => ({ ...prev, ...patch } as LocalSettings))
    setDirty(true)
    setSaveStatus('idle')
  }, [])

  const handleSave = useCallback(() => {
    // Core에 전송 (Core가 저장 처리)
    sendToHost({ type: 'settings_update', payload: buildPayload(settings) })
    saved.current = { ...settings }
    setDirty(false)
    setSaveStatus('saved')
    setTimeout(() => setSaveStatus('idle'), 2000)
  }, [settings])

  const handleCancel = useCallback(() => {
    setSettings({ ...saved.current })
    setDirty(false)
    setSaveStatus('idle')
  }, [])

  const handleClose = useCallback(() => {
    // 미저장 변경은 자동 폐기 (JCEF 환경에서 confirm 미지원)
    if (dirty) {
      setSettings({ ...saved.current })
      setDirty(false)
    }
    onClose()
  }, [dirty, onClose])

  // 숫자 값 clamp 유틸
  const clampNumber = (val: number, min: number, max: number) =>
    Math.max(min, Math.min(max, val))

  return (
    <div className="settings-panel">
      <div className="settings-header">
        <button className="icon-btn" onClick={handleClose}>←</button>
        <span>설정</span>
        <div className="settings-header-actions">
          {dirty && (
            <button className="settings-btn cancel-btn" onClick={handleCancel}>취소</button>
          )}
          <button
            className={`settings-btn save-btn ${dirty ? 'active' : ''} ${saveStatus === 'saved' ? 'saved' : ''}`}
            onClick={handleSave}
            disabled={!dirty}
          >
            {saveStatus === 'saved' ? '✓ 저장됨' : '저장'}
          </button>
        </div>
      </div>
      <div className="settings-content">
        {/* ── Provider 선택 ── */}
        <div className="settings-group">
          <div className="settings-label">AI 제공자</div>
          <select
            className="settings-select"
            value={settings.provider}
            onChange={e => handleChange({ provider: e.target.value })}
          >
            <option value="ollama">Ollama</option>
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
          </select>
        </div>

        {/* ── Provider별 설정 ── */}
        {settings.provider === 'ollama' && (
          <OllamaSettings
            baseUrl={settings.ollamaBaseUrl}
            apiKey={settings.ollamaApiKey}
            model={settings.ollamaModel}
            onChange={handleChange}
          />
        )}

        {settings.provider === 'openai' && (
          <>
            <div className="settings-group">
              <div className="settings-label">API 키</div>
              <ApiKeyField
                value={settings.openAiApiKey}
                placeholder="sk-..."
                onChange={v => handleChange({ openAiApiKey: v })}
              />
            </div>
            <div className="settings-group">
              <div className="settings-label">모델</div>
              <input
                className="settings-input"
                value={settings.openAiModel}
                onChange={e => handleChange({ openAiModel: e.target.value })}
              />
            </div>
            <div className="settings-group">
              <div className="settings-label">Base URL</div>
              <input
                className="settings-input"
                value={settings.openAiBaseUrl}
                onChange={e => handleChange({ openAiBaseUrl: e.target.value })}
              />
            </div>
          </>
        )}

        {settings.provider === 'anthropic' && (
          <>
            <div className="settings-group">
              <div className="settings-label">API 키</div>
              <ApiKeyField
                value={settings.anthropicApiKey}
                placeholder="sk-ant-..."
                onChange={v => handleChange({ anthropicApiKey: v })}
              />
            </div>
            <div className="settings-group">
              <div className="settings-label">모델</div>
              <input
                className="settings-input"
                value={settings.anthropicModel}
                onChange={e => handleChange({ anthropicModel: e.target.value })}
              />
            </div>
          </>
        )}

        {/* ── Common Settings (모든 Provider 공통) ── */}
        <div className="settings-divider" />

        <div className="settings-group">
          <div className="settings-label">컨텍스트 윈도우</div>
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
          <div className="settings-label">요청 타임아웃 (ms)</div>
          <input
            className="settings-input"
            type="number"
            min={5000}
            max={600000}
            value={settings.requestTimeoutMs}
            onChange={e => handleChange({
              requestTimeoutMs: clampNumber(Number(e.target.value), 5000, 600000)
            })}
          />
          <div className="settings-hint">요청당 최대 대기 시간. 대용량 모델은 값을 높게 설정하세요.</div>
        </div>
      </div>
    </div>
  )
}
