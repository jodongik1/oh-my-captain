// 채팅/세션/모드 콜백을 한 곳에 모은 훅.
// App.tsx 가 7개 콜백을 직접 들고 있던 구조를 지우고, 본 훅이 (state, dispatch, bridge) 를 받아
// 각 콜백을 메모이즈된 함수로 돌려준다.
//
// 책임 경계:
// - 본 훅은 "사용자 액션 → 호스트 메시지 + store 업데이트" 의 통합만 담당한다.
// - UI 토글(설정/히스토리 토글) 처럼 dispatch 한 줄로 끝나는 동작은 호출 측이 직접 dispatch 한다.

import { useCallback } from 'react'
import type { Dispatch } from 'react'
import type { AppAction, AppState, Mode, Attachment, ModelInfo } from '../store'
import type { IHostBridge } from '../bridge/jcef'
import { useHostBridge } from '../bridge/HostBridgeContext'

export interface ChatActions {
  send(text: string): void
  attachmentsAdd(attachments: Attachment[]): void
  attachmentRemove(index: number): void
  modeChange(mode: Mode): void
  approvalResponse(requestId: string, approved: boolean): void
  abort(): void
  retryLastUser(): void
  newSession(): void
  modelSelect(model: ModelInfo): void
  executePlan(targetMode: 'ask' | 'auto'): void
  titleChange(title: string): void
  toggleHistory(): void
  openSettings(): void
}

interface Args {
  state: AppState
  dispatch: Dispatch<AppAction>
}

/** 첨부 파일 → 호스트 페이로드용 슬림 형태로 변환 (UI 전용 필드 제거). */
function serializeAttachments(attachments: Attachment[]) {
  return attachments.map(a => ({
    kind: a.kind,
    mediaType: a.mediaType,
    data: a.data,
    filename: a.filename,
  }))
}

function buildUserMessagePayload(text: string, sessionId: string | null, attachments: Attachment[]) {
  return {
    text,
    sessionId: sessionId ?? undefined,
    ...(attachments.length > 0 ? { attachments: serializeAttachments(attachments) } : {}),
  }
}

export function useChatActions({ state, dispatch }: Args): ChatActions {
  const bridge: IHostBridge = useHostBridge()
  const { sessionId, isBusy, pendingAttachments, timeline, showHistory } = state

  const send = useCallback((text: string) => {
    if (isBusy) return
    // `!cmd` 는 LLM 으로 가지 않고 로컬 셸에서 직접 실행. 결과는 다음 LLM turn 컨텍스트로 누적.
    if (text.startsWith('!')) {
      const command = text.slice(1).trim()
      if (!command) return
      // 사용자 입력은 그대로 timeline 에 기록 (`!cmd` 형태). 결과 entry 는 core 가 tool_start/result 로 push.
      dispatch({
        type: 'ADD_TIMELINE',
        entry: {
          id: Date.now().toString(),
          type: 'user',
          content: text,
          timestamp: Date.now(),
        },
      })
      bridge.send('shell_exec', { command })
      return
    }
    const attachments = pendingAttachments
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
    if (attachments.length > 0) dispatch({ type: 'CLEAR_ATTACHMENTS' })
    dispatch({ type: 'SET_BUSY', busy: true })
    bridge.send('user_message', buildUserMessagePayload(text, sessionId, attachments))
  }, [bridge, dispatch, isBusy, sessionId, pendingAttachments])

  const attachmentsAdd = useCallback((attachments: Attachment[]) => {
    dispatch({ type: 'ADD_ATTACHMENTS', attachments })
  }, [dispatch])

  const attachmentRemove = useCallback((index: number) => {
    dispatch({ type: 'REMOVE_ATTACHMENT', index })
  }, [dispatch])

  const modeChange = useCallback((mode: Mode) => {
    dispatch({ type: 'SET_MODE', mode })
    bridge.send('mode_change', { mode })
  }, [bridge, dispatch])

  const approvalResponse = useCallback((requestId: string, approved: boolean) => {
    dispatch({ type: 'RESOLVE_APPROVAL', requestId, approved })
    bridge.send('approval_response', { requestId, approved })
  }, [bridge, dispatch])

  const abort = useCallback(() => {
    bridge.send('abort', {})
    dispatch({ type: 'SET_BUSY', busy: false })
    dispatch({ type: 'MARK_INTERRUPTED' })
  }, [bridge, dispatch])

  const retryLastUser = useCallback(() => {
    if (isBusy) return
    let lastUserText: string | null = null
    let lastUserAttachments: Attachment[] | undefined
    for (let i = timeline.length - 1; i >= 0; i--) {
      const e = timeline[i]
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
    bridge.send('user_message', buildUserMessagePayload(lastUserText, sessionId, lastUserAttachments ?? []))
  }, [bridge, dispatch, isBusy, sessionId, timeline])

  const newSession = useCallback(() => {
    dispatch({ type: 'NEW_SESSION' })
    bridge.send('session_new', {})
    bridge.send('session_list', {})
  }, [bridge, dispatch])

  const modelSelect = useCallback((model: ModelInfo) => {
    bridge.send('model_switch', { modelId: model.id })
    dispatch({ type: 'TOGGLE_MODEL_SELECTOR' })
  }, [bridge, dispatch])

  // Plan 모드 → 실행 모드로 전환하면서 즉시 실행
  const executePlan = useCallback((targetMode: 'ask' | 'auto') => {
    dispatch({ type: 'SET_MODE', mode: targetMode })
    bridge.send('mode_change', { mode: targetMode })
    const text = '위 계획대로 진행해주세요.'
    dispatch({
      type: 'ADD_TIMELINE',
      entry: { id: Date.now().toString(), type: 'user', content: text, timestamp: Date.now() },
    })
    dispatch({ type: 'SET_BUSY', busy: true })
    bridge.send('user_message', { text, sessionId: sessionId ?? undefined })
  }, [bridge, dispatch, sessionId])

  const titleChange = useCallback((title: string) => {
    // 로컬 타이틀은 항상 즉시 갱신 — sessionId 가 아직 없는 New Session 에서도 동작해야 함.
    dispatch({ type: 'SET_SESSION_TITLE', title })
    // 영속화된 세션이면 호스트에 rename 전파.
    if (sessionId) bridge.send('session_rename', { sessionId, title })
  }, [bridge, dispatch, sessionId])

  const toggleHistory = useCallback(() => {
    const wasOpen = showHistory
    dispatch({ type: 'TOGGLE_HISTORY' })
    if (!wasOpen) bridge.send('session_list', {})
  }, [bridge, dispatch, showHistory])

  const openSettings = useCallback(() => {
    dispatch({ type: 'TOGGLE_SETTINGS' })
  }, [dispatch])

  return {
    send,
    attachmentsAdd,
    attachmentRemove,
    modeChange,
    approvalResponse,
    abort,
    retryLastUser,
    newSession,
    modelSelect,
    executePlan,
    titleChange,
    toggleHistory,
    openSettings,
  }
}
