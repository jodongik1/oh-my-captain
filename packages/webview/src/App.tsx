import { useEffect } from 'react'
import { useAppStore } from './store'
import { useIpcMessageHandler } from './bridge/ipc/useIpcMessageHandler'
import { useChatActions } from './hooks/useChatActions'
import { useHistoryActions } from './hooks/useHistoryActions'
import HeaderBar from './components/HeaderBar'
import Timeline from './components/Timeline'
import InputConsole from './components/InputConsole'
import HistoryPopup from './components/HistoryPopup'
import SettingsPanel from './components/settings/SettingsPanel'
import { Toaster } from 'sonner'

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

/** 팝업/오버레이가 하나라도 열려 있으면 글로벌 Esc(중단) 보다 팝업 닫기에 우선권을 양보. */
function isAnyPopupOpen(state: ReturnType<typeof useAppStore>[0]): boolean {
  return state.showHistory || state.showSettings || state.showModelSelector || state.slashFilter !== null
}

export default function App() {
  const [state, dispatch] = useAppStore()

  // [흐름 7] Core → Bridge → React 라우팅 (도메인별 핸들러 합성은 bridge/ipc/handlers 참고)
  useIpcMessageHandler(dispatch)

  const actions = useChatActions({ state, dispatch })
  const history = useHistoryActions(dispatch)

  // 글로벌 Esc → isBusy 면 abort. 팝업이 열려 있을 땐 팝업 닫기 우선권을 양보.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !state.isBusy) return
      if (isAnyPopupOpen(state)) return
      actions.abort()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state, actions])

  const hasContent = state.timeline.length > 0
  const showOnboarding = state.isConfigured === false

  return (
    <div className="app-container">
      <Toaster theme="dark" position="bottom-center" />

      {!state.showSettings && (
        <HeaderBar
          sessionTitle={state.sessionTitle}
          onHistoryToggle={actions.toggleHistory}
          onNewSession={actions.newSession}
          onTitleChange={actions.titleChange}
          isBusy={state.isBusy}
        />
      )}

      {state.showHistory && (
        <HistoryPopup
          sessions={state.sessions}
          currentSessionId={state.sessionId}
          onSelect={history.selectSession}
          onDelete={history.deleteSession}
          onRename={history.renameSession}
          onClose={() => dispatch({ type: 'TOGGLE_HISTORY' })}
        />
      )}

      {state.showSettings && state.settings && (
        <SettingsPanel
          initialSettings={state.settings}
          initialModels={state.availableModels}
          onClose={() => dispatch({ type: 'TOGGLE_SETTINGS' })}
          onModelsUpdate={(models) => dispatch({ type: 'SET_AVAILABLE_MODELS', models })}
        />
      )}

      {showOnboarding ? (
        <OnboardingView onOpenSettings={actions.openSettings} />
      ) : hasContent ? (
        <Timeline
          entries={state.timeline}
          isBusy={state.isBusy}
          currentActivity={state.currentActivity}
          mode={state.mode}
          onApprovalResponse={actions.approvalResponse}
          onAbort={actions.abort}
          onExecutePlan={actions.executePlan}
          onRetryLastUser={actions.retryLastUser}
        />
      ) : (
        <EmptyView />
      )}

      {!showOnboarding && (
        <InputConsole
          mode={state.mode}
          contextUsage={state.contextUsage}
          isBusy={state.isBusy}
          currentActivity={state.currentActivity}
          currentModel={state.currentModel}
          availableModels={state.availableModels}
          showModelSelector={state.showModelSelector}
          slashFilter={state.slashFilter}
          fileSearchResults={state.fileSearchResults}
          pendingAttachments={state.pendingAttachments}
          currentModelCapabilities={state.currentModelCapabilities}
          onSend={actions.send}
          onModeChange={actions.modeChange}
          onAbort={actions.abort}
          onSlashFilterChange={(f) => dispatch({ type: 'SET_SLASH_FILTER', filter: f })}
          onToggleModelSelector={() => dispatch({ type: 'TOGGLE_MODEL_SELECTOR' })}
          onModelSelect={actions.modelSelect}
          onNewSession={actions.newSession}
          onOpenSettings={actions.openSettings}
          onAttachmentsAdd={actions.attachmentsAdd}
          onAttachmentRemove={actions.attachmentRemove}
          onToggleHistory={actions.toggleHistory}
        />
      )}
    </div>
  )
}

function OnboardingView({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <div className="empty-state">
      <div className="welcome-compass-wrapper"><CompassIcon /></div>
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
          onClick={onOpenSettings}
        >
          설정 이동
        </button>
      </div>
    </div>
  )
}

function EmptyView() {
  return (
    <div className="empty-state">
      <div className="welcome-compass-wrapper"><CompassIcon /></div>
      <div className="welcome-brand">
        <h1 className="welcome-title">Oh My Captain</h1>
        <p className="welcome-tagline">AI 코딩 어시스턴트</p>
      </div>
      <div className="welcome-divider" />
      <p className="welcome-hint">
        아래에 메시지를 입력하거나<br />슬래시 명령어로 시작하세요.
      </p>
    </div>
  )
}
