// 세션 / 모델 / 파일 검색 도메인 핸들러.

import type { IpcHandlerFactory } from '../types'
import type { TimelineEntry } from '../../../store'

export const createSessionHandlers: IpcHandlerFactory = ({ dispatch }) => ({
  sessions_list: (payload) => {
    dispatch({ type: 'SET_SESSIONS', sessions: payload.sessions })
  },

  session_history: (payload) => {
    for (const m of payload.messages) {
      // tool 역할은 timeline 에 직접 풀어내지 않음 (현재 정책: user/assistant 만 복원)
      let entry: TimelineEntry | null = null
      if (m.role === 'user') {
        entry = { id: m.id, type: 'user', content: m.content, timestamp: m.timestamp }
      } else if (m.role === 'assistant') {
        entry = { id: m.id, type: 'stream', content: m.content, timestamp: m.timestamp }
      }
      if (entry) dispatch({ type: 'ADD_TIMELINE', entry })
    }
  },

  model_list_result: (payload) => {
    dispatch({ type: 'SET_AVAILABLE_MODELS', models: payload.models })
    dispatch({ type: 'SET_MODEL', modelId: payload.currentModel })
  },

  model_switched: (payload) => {
    dispatch({
      type: 'SET_MODEL',
      modelId: payload.modelId,
      contextWindow: payload.contextWindow,
      capabilities: payload.capabilities,
    })
  },

  file_search_result: (payload) => {
    dispatch({ type: 'SET_FILE_SEARCH_RESULTS', files: payload.files })
  },
})
