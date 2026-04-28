// 부트스트랩 / 설정 / 승인 — webview 단의 시스템 라이프사이클 핸들러.

import type { IpcHandlerFactory } from '../types'
import type { TimelineEntry } from '../../../store'

export const createSystemHandlers: IpcHandlerFactory = ({ dispatch, bridge }) => ({
  // 호스트 측 IpcMessageType.CORE_READY — Core 프로세스 준비 완료 신호.
  // 설정 + 세션 목록 부트스트랩 요청을 발사한다.
  core_ready: () => {
    bridge.send('settings_get', {})
    bridge.send('session_list', {})
  },

  settings_loaded: (payload) => {
    dispatch({
      type: 'SETTINGS_LOADED',
      isConfigured: !payload.isFirstTime,
      settings: payload.settings,
    })
    if (payload.settings?.cachedModels?.length) {
      dispatch({ type: 'SET_AVAILABLE_MODELS', models: payload.settings.cachedModels })
    }
  },

  approval_request: (payload) => {
    // 호스트(ApprovalEnvelopeAdapter) 가 envelope.id 를 payload.id 로 enrich 한 형태로 도착한다.
    // approval.requestId 는 webview 가 응답 시 그대로 돌려보내야 host 가 envelope.id 로 승격해 매칭한다.
    const entry: TimelineEntry = {
      id: payload.id,
      type: 'approval',
      timestamp: Date.now(),
      isActive: true,
      approval: {
        requestId: payload.id,
        action: payload.action,
        description: payload.description,
        risk: payload.risk,
        details: payload.details,
      },
    }
    dispatch({ type: 'ADD_APPROVAL', entry })
  },
})
