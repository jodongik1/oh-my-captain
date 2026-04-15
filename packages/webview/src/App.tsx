import { useEffect, useCallback } from 'react'
import { useAppStore } from './store'
import { onHostMessage, sendToHost } from './bridge/jcef'
import HeaderBar from './components/HeaderBar'
import Timeline from './components/Timeline'
import InputConsole from './components/InputConsole'
import HistoryPopup from './components/HistoryPopup'
import SettingsPanel from './components/settings/SettingsPanel'
import { Toaster } from 'sonner'
import type { TimelineEntry, ModelInfo } from './store'
function CompassIcon() {
  return (
    <svg width="72" height="72" viewBox="0 0 24 24" className="compass-svg" aria-hidden="true">
      <circle cx="12" cy="12" r="10" className="compass-ring" />
      <g className="compass-needle">
        <polygon points="16.24,7.76 14.12,14.12 9.88,9.88" className="compass-needle-north" />
        <polygon points="7.76,16.24 14.12,14.12 9.88,9.88" className="compass-needle-south" />
      </g>
    </svg>
  )
}

export default function App() {
  const [state, dispatch] = useAppStore()

  // Core → React 메시지 수신
  useEffect(() => {
    let currentSource: 'chat' | 'action' = 'chat'

    return onHostMessage((msg) => {
      switch (msg.type) {
        case 'stream_start':
          currentSource = (msg.payload as { source: 'chat' | 'action' }).source
          break

        case 'stream_chunk':
          dispatch({ type: 'STREAM_TOKEN', token: (msg.payload as { token: string }).token, source: currentSource })
          break

        case 'stream_end':
          dispatch({ type: 'STREAM_END' })
          break

        case 'tool_start': {
          // 도구 시작 직전 → 이전 스트림이 preamble이면 자동 제거
          dispatch({ type: 'PRUNE_PREAMBLE' })
          const p = msg.payload as { tool: string; args: unknown }
          const entry: TimelineEntry = {
            id: Date.now().toString() + Math.random(),
            type: 'tool_start',
            tool: p.tool,
            args: p.args,
            timestamp: Date.now(),
            isActive: true,
            startedAt: Date.now()
          }
          dispatch({ type: 'ADD_TIMELINE', entry })
          break
        }

        case 'tool_result': {
          const p = msg.payload as { tool: string; result: unknown }
          // tool_start entry에 result 병합 (별도 entry 생성 안함)
          dispatch({ type: 'COMPLETE_TOOL', tool: p.tool, result: p.result })
          break
        }

        case 'thinking_start': {
          dispatch({
            type: 'ADD_TIMELINE',
            entry: {
              id: Date.now().toString(),
              type: 'thinking',
              durationMs: 0,
              isActive: true,
              startedAt: Date.now(),
              timestamp: Date.now()
            }
          })
          break
        }

        case 'thinking_end': {
          const p = msg.payload as { durationMs: number; content?: string }
          dispatch({ type: 'COMPLETE_THINKING', durationMs: p.durationMs, content: p.content })
          break
        }

        case 'context_usage':
          dispatch({ type: 'SET_CONTEXT_USAGE', usage: msg.payload as any })
          break

        case 'error': {
          const p = msg.payload as { message: string }
          dispatch({ type: 'ADD_ERROR', message: p.message })
          break
        }

        case 'sessions_list': {
          const p = msg.payload as { sessions: any[] }
          dispatch({ type: 'SET_SESSIONS', sessions: p.sessions })
          break
        }

        case 'session_history': {
          const p = msg.payload as { messages: any[] }
          for (const m of p.messages) {
            if (m.role === 'user') {
              dispatch({ type: 'ADD_TIMELINE', entry: { id: m.id, type: 'user', content: m.content, timestamp: m.timestamp } })
            } else if (m.role === 'assistant') {
              dispatch({ type: 'ADD_TIMELINE', entry: { id: m.id, type: 'stream', content: m.content, timestamp: m.timestamp } })
            }
          }
          break
        }

        case 'model_list_result': {
          const p = msg.payload as { models: ModelInfo[]; currentModel: string }
          dispatch({ type: 'SET_AVAILABLE_MODELS', models: p.models })
          dispatch({ type: 'SET_MODEL', modelId: p.currentModel })
          break
        }

        case 'model_switched': {
          const p = msg.payload as { modelId: string; contextWindow: number }
          dispatch({ type: 'SET_MODEL', modelId: p.modelId, contextWindow: p.contextWindow })
          break
        }

        case 'core_ready': {
          sendToHost({ type: 'settings_get', payload: {} })
          sendToHost({ type: 'session_list', payload: {} })
          break
        }

        case 'settings_loaded': {
          const p = msg.payload as { settings: any; isFirstTime: boolean }
          console.error('[REACT IPC DEBUG] settings_loaded RECEIVED:', JSON.stringify(msg.payload))
          dispatch({ type: 'SETTINGS_LOADED', isConfigured: !p.isFirstTime, settings: p.settings })
          if (p.settings?.cachedModels?.length) {
            dispatch({ type: 'SET_AVAILABLE_MODELS', models: p.settings.cachedModels })
          }
          break
        }

        case 'approval_request': {
          const p = msg.payload as { id: string; action: string; description: string; risk: 'low' | 'medium' | 'high'; details?: unknown }
          const requestId = p.id
          const entry: TimelineEntry = {
            id: requestId,
            type: 'approval',
            timestamp: Date.now(),
            isActive: true,
            approval: {
              requestId,
              action: p.action,
              description: p.description,
              risk: p.risk,
              details: p.details,
            },
          }
          dispatch({ type: 'ADD_APPROVAL', entry })
          break
        }
      }
    })
  }, [dispatch])

  const handleSend = useCallback((text: string) => {
    dispatch({
      type: 'ADD_TIMELINE',
      entry: { id: Date.now().toString(), type: 'user', content: text, timestamp: Date.now() }
    })
    dispatch({ type: 'SET_BUSY', busy: true })
    sendToHost({ type: 'user_message', payload: { text, sessionId: state.sessionId ?? undefined } })
  }, [dispatch, state.sessionId])

  const handleModeChange = useCallback((mode: typeof state.mode) => {
    dispatch({ type: 'SET_MODE', mode })
    sendToHost({ type: 'mode_change', payload: { mode } })
  }, [dispatch])

  const handleApprovalResponse = useCallback((requestId: string, approved: boolean) => {
    dispatch({ type: 'RESOLVE_APPROVAL', requestId, approved })
    sendToHost({ type: 'approval_response', payload: { requestId, approved } })
  }, [dispatch])

  const handleAbort = useCallback(() => {
    sendToHost({ type: 'abort', payload: {} })
    dispatch({ type: 'SET_BUSY', busy: false })
  }, [dispatch])

  const handleNewSession = useCallback(() => {
    dispatch({ type: 'NEW_SESSION' })
    sendToHost({ type: 'session_new', payload: {} })
    sendToHost({ type: 'session_list', payload: {} })
  }, [dispatch])

  const handleModelSelect = useCallback((model: ModelInfo) => {
    sendToHost({ type: 'model_switch', payload: { modelId: model.id } })
    dispatch({ type: 'TOGGLE_MODEL_SELECTOR' })
  }, [dispatch])

  const handleTitleChange = useCallback((title: string) => {
    dispatch({ type: 'RENAME_SESSION', sessionId: state.sessionId ?? '', title })
    if (state.sessionId) {
      sendToHost({ type: 'session_rename', payload: { sessionId: state.sessionId, title } })
    }
  }, [dispatch, state.sessionId])

  const hasContent = state.timeline.length > 0

  return (
    <div className="app-container">
      <Toaster theme="dark" position="bottom-center" />
      {!state.showSettings && (
        <HeaderBar
          sessionTitle={state.sessionTitle}
          onHistoryToggle={() => {
            dispatch({ type: 'TOGGLE_HISTORY' })
            if (!state.showHistory) sendToHost({ type: 'session_list', payload: {} })
          }}
          onNewSession={handleNewSession}
          onTitleChange={handleTitleChange}
          isBusy={state.isBusy}
        />
      )}

      {state.showHistory && (
        <HistoryPopup
          sessions={state.sessions}
          currentSessionId={state.sessionId}
          onSelect={(id, title) => dispatch({ type: 'SELECT_SESSION', sessionId: id, title })}
          onDelete={(id) => dispatch({ type: 'DELETE_SESSION', sessionId: id })}
          onRename={(id, title) => dispatch({ type: 'RENAME_SESSION', sessionId: id, title })}
          onClose={() => dispatch({ type: 'TOGGLE_HISTORY' })}
        />
      )}

      {state.showSettings && (
        <SettingsPanel
          initialSettings={state.settings}
          initialModels={state.availableModels}
          onClose={() => dispatch({ type: 'TOGGLE_SETTINGS' })}
          onModelsUpdate={(models) => dispatch({ type: 'SET_AVAILABLE_MODELS', models })}
        />
      )}

      {state.isConfigured === false ? (
        <div className="empty-state">
          <div className="welcome-compass-wrapper">
            <CompassIcon />
          </div>
          <div className="welcome-brand">
            <h1 className="welcome-title">Oh My Captain</h1>
            <p className="welcome-tagline">AI 코딩 어시스턴트</p>
          </div>
          <div className="welcome-divider" />
          <div className="welcome-hint">
            <p>플러그인을 시작하려면 최초 모델 연결이 필요합니다.</p>
            <button
              className="settings-btn save-btn active"
              style={{ marginTop: '15px', padding: '10px 20px', fontSize: '14px' }}
              onClick={() => dispatch({ type: 'TOGGLE_SETTINGS' })}
            >
              설정 이동
            </button>
          </div>
        </div>
      ) : hasContent ? (
        <Timeline entries={state.timeline} isBusy={state.isBusy} onApprovalResponse={handleApprovalResponse} />
      ) : (
        <div className="empty-state">
          <div className="welcome-compass-wrapper">
            <CompassIcon />
          </div>
          <div className="welcome-brand">
            <h1 className="welcome-title">Oh My Captain</h1>
            <p className="welcome-tagline">AI 코딩 어시스턴트</p>
          </div>
          <div className="welcome-divider" />
          <p className="welcome-hint">
            아래에 메시지를 입력하거나<br />슬래시 명령어로 시작하세요.
          </p>
        </div>
      )}

      {state.isConfigured !== false && (
        <InputConsole
          mode={state.mode}
          contextUsage={state.contextUsage}
          isBusy={state.isBusy}
          currentModel={state.currentModel}
          availableModels={state.availableModels}
          showModelSelector={state.showModelSelector}
          slashFilter={state.slashFilter}
          onSend={handleSend}
          onModeChange={handleModeChange}
          onAbort={handleAbort}
          onSlashFilterChange={(f) => dispatch({ type: 'SET_SLASH_FILTER', filter: f })}
          onToggleModelSelector={() => dispatch({ type: 'TOGGLE_MODEL_SELECTOR' })}
          onModelSelect={handleModelSelect}
          onNewSession={handleNewSession}
          onOpenSettings={() => dispatch({ type: 'TOGGLE_SETTINGS' })}
        />
      )}
    </div>
  )
}
