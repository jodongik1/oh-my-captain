import { useCallback } from 'react'
import { useAppStore } from './store'
import { sendToHost } from './bridge/jcef'
import { useIpcMessageHandler } from './bridge/ipc/useIpcMessageHandler'
import HeaderBar from './components/HeaderBar'
import Timeline from './components/Timeline'
import InputConsole from './components/InputConsole'
import HistoryPopup from './components/HistoryPopup'
import SettingsPanel from './components/settings/SettingsPanel'
import { Toaster } from 'sonner'
import type { ModelInfo } from './store'
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

  // [흐름 7] Core → Bridge → React 메시지 라우팅. 타입별 핸들러는 bridge/ipc/handlers.ts 참고.
  useIpcMessageHandler(dispatch)

  // [흐름 2] InputConsole의 onSend 콜백 → Bridge를 통해 Core로 메시지 전달
  const handleSend = useCallback((text: string) => {
    // 타임라인에 사용자 메시지를 즉시 추가 (낙관적 업데이트)
    dispatch({
      type: 'ADD_TIMELINE',
      entry: { id: Date.now().toString(), type: 'user', content: text, timestamp: Date.now() }
    })
    dispatch({ type: 'SET_BUSY', busy: true })
    // [흐름 3] jcef.ts sendToHost → window.__omcBridge.send → Kotlin → Node.js stdin
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
