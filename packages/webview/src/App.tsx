import { useCallback, useEffect } from 'react'
import { useAppStore } from './store'
import { sendToHost } from './bridge/jcef'
import { useIpcMessageHandler } from './bridge/ipc/useIpcMessageHandler'
import HeaderBar from './components/HeaderBar'
import Timeline from './components/Timeline'
import InputConsole from './components/InputConsole'
import HistoryPopup from './components/HistoryPopup'
import SettingsPanel from './components/settings/SettingsPanel'
import { Toaster } from 'sonner'
import type { ModelInfo, Attachment } from './store'
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
  // isBusy 면 진행 중인 turn 에 메시지 주입(steer_inject), 아니면 새 turn 시작.
  const handleSend = useCallback((text: string) => {
    const attachments = state.pendingAttachments
    // 사용자 메시지는 양쪽 다 timeline 에 즉시 추가 (낙관적 업데이트)
    dispatch({
      type: 'ADD_TIMELINE',
      entry: {
        id: Date.now().toString(),
        type: 'user',
        content: text,
        timestamp: Date.now(),
        ...(attachments.length > 0 ? { attachments } : {}),
      },
    })
    // 보낸 직후 첨부는 비움
    if (attachments.length > 0) {
      dispatch({ type: 'CLEAR_ATTACHMENTS' })
    }
    if (state.isBusy) {
      // 진행 중인 에이전트 루프에 사용자 지시 주입
      // (attachments 는 새 turn 에서만 처리 — steering 에서는 텍스트만)
      sendToHost({ type: 'steer_inject', payload: { text } })
      return
    }
    dispatch({ type: 'SET_BUSY', busy: true })
    // [흐름 3] jcef.ts sendToHost → window.__omcBridge.send → Kotlin → Node.js stdin
    sendToHost({
      type: 'user_message',
      payload: {
        text,
        sessionId: state.sessionId ?? undefined,
        ...(attachments.length > 0
          ? {
              attachments: attachments.map(a => ({
                kind: a.kind, mediaType: a.mediaType, data: a.data, filename: a.filename,
              })),
            }
          : {}),
      },
    })
  }, [dispatch, state.sessionId, state.isBusy, state.pendingAttachments])

  const handleAttachmentsAdd = useCallback((attachments: Attachment[]) => {
    dispatch({ type: 'ADD_ATTACHMENTS', attachments })
  }, [dispatch])

  const handleAttachmentRemove = useCallback((index: number) => {
    dispatch({ type: 'REMOVE_ATTACHMENT', index })
  }, [dispatch])

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
    // 진행 중이던 entry 들에 interrupted 마크 + 별도 "사용자가 중단함" 행 추가
    dispatch({ type: 'MARK_INTERRUPTED' })
  }, [dispatch])

  // 중단 후 마지막 user 메시지를 다시 새 turn 으로 전송
  const handleRetryLastUser = useCallback(() => {
    if (state.isBusy) return
    // timeline 을 거꾸로 훑어서 가장 최근 user 메시지 찾기
    let lastUserText: string | null = null
    let lastUserAttachments: Attachment[] | undefined
    for (let i = state.timeline.length - 1; i >= 0; i--) {
      const e = state.timeline[i]
      if (e.type === 'user') {
        lastUserText = e.content ?? ''
        lastUserAttachments = e.attachments
        break
      }
    }
    if (!lastUserText) return
    dispatch({
      type: 'ADD_TIMELINE',
      entry: {
        id: Date.now().toString(),
        type: 'user',
        content: lastUserText,
        timestamp: Date.now(),
        ...(lastUserAttachments && lastUserAttachments.length > 0 ? { attachments: lastUserAttachments } : {}),
      },
    })
    dispatch({ type: 'SET_BUSY', busy: true })
    sendToHost({
      type: 'user_message',
      payload: {
        text: lastUserText,
        sessionId: state.sessionId ?? undefined,
        ...(lastUserAttachments && lastUserAttachments.length > 0
          ? {
              attachments: lastUserAttachments.map(a => ({
                kind: a.kind, mediaType: a.mediaType, data: a.data, filename: a.filename,
              })),
            }
          : {}),
      },
    })
  }, [dispatch, state.isBusy, state.sessionId, state.timeline])

  // 글로벌 Esc → isBusy 일 때 abort. 단, 팝업이 열려 있으면 팝업 닫기에 우선권을 양보.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !state.isBusy) return
      if (state.showHistory || state.showSettings || state.showModelSelector || state.slashFilter !== null) return
      handleAbort()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state.isBusy, state.showHistory, state.showSettings, state.showModelSelector, state.slashFilter, handleAbort])

  const handleNewSession = useCallback(() => {
    dispatch({ type: 'NEW_SESSION' })
    sendToHost({ type: 'session_new', payload: {} })
    sendToHost({ type: 'session_list', payload: {} })
  }, [dispatch])

  const handleModelSelect = useCallback((model: ModelInfo) => {
    sendToHost({ type: 'model_switch', payload: { modelId: model.id } })
    dispatch({ type: 'TOGGLE_MODEL_SELECTOR' })
  }, [dispatch])

  // Plan 모드의 계획을 실행 모드로 전환하면서 즉시 시작
  const handleExecutePlan = useCallback((targetMode: 'ask' | 'auto') => {
    dispatch({ type: 'SET_MODE', mode: targetMode })
    sendToHost({ type: 'mode_change', payload: { mode: targetMode } })
    const text = '위 계획대로 진행해주세요.'
    dispatch({
      type: 'ADD_TIMELINE',
      entry: { id: Date.now().toString(), type: 'user', content: text, timestamp: Date.now() }
    })
    dispatch({ type: 'SET_BUSY', busy: true })
    sendToHost({ type: 'user_message', payload: { text, sessionId: state.sessionId ?? undefined } })
  }, [dispatch, state.sessionId])

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
        <Timeline
          entries={state.timeline}
          isBusy={state.isBusy}
          currentActivity={state.currentActivity}
          mode={state.mode}
          onApprovalResponse={handleApprovalResponse}
          onAbort={handleAbort}
          onExecutePlan={handleExecutePlan}
          onRetryLastUser={handleRetryLastUser}
        />
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
          currentActivity={state.currentActivity}
          currentModel={state.currentModel}
          availableModels={state.availableModels}
          showModelSelector={state.showModelSelector}
          slashFilter={state.slashFilter}
          fileSearchResults={state.fileSearchResults}
          pendingAttachments={state.pendingAttachments}
          currentModelCapabilities={state.currentModelCapabilities}
          onSend={handleSend}
          onModeChange={handleModeChange}
          onAbort={handleAbort}
          onSlashFilterChange={(f) => dispatch({ type: 'SET_SLASH_FILTER', filter: f })}
          onToggleModelSelector={() => dispatch({ type: 'TOGGLE_MODEL_SELECTOR' })}
          onModelSelect={handleModelSelect}
          onNewSession={handleNewSession}
          onOpenSettings={() => dispatch({ type: 'TOGGLE_SETTINGS' })}
          onAttachmentsAdd={handleAttachmentsAdd}
          onAttachmentRemove={handleAttachmentRemove}
          onToggleHistory={() => {
            dispatch({ type: 'TOGGLE_HISTORY' })
            if (!state.showHistory) sendToHost({ type: 'session_list', payload: {} })
          }}
        />
      )}
    </div>
  )
}
