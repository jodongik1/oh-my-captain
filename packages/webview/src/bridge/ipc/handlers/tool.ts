// 도구 도메인 핸들러.
// 책임: tool_start (활동 라벨 + timeline 추가) · tool_result (결과 병합 후 'preparing' 으로 전환)

import type { IpcHandlerFactory } from '../types'
import type { TimelineEntry } from '../../../store'
import { buildToolStatusLabel } from '../../../tools/registry'

export const createToolHandlers: IpcHandlerFactory = ({ dispatch }) => ({
  tool_start: (payload) => {
    // 도구 시작 직전 → 직전 stream 을 thinking 으로 승격 (preamble 이면 reducer 가 제거).
    dispatch({ type: 'ELEVATE_STREAM_TO_THINKING' })
    dispatch({
      type: 'SET_ACTIVITY',
      activity: {
        type: 'tool',
        label: buildToolStatusLabel(payload.tool, payload.args),
        tool: payload.tool,
        startedAt: Date.now(),
      },
    })
    const entry: TimelineEntry = {
      id: Date.now().toString() + Math.random(),
      type: 'tool_start',
      tool: payload.tool,
      args: payload.args,
      timestamp: Date.now(),
      isActive: true,
      startedAt: Date.now(),
    }
    dispatch({ type: 'ADD_TIMELINE', entry })
  },

  tool_result: (payload) => {
    dispatch({ type: 'COMPLETE_TOOL', tool: payload.tool, result: payload.result })
    // 도구 종료 ~ 다음 LLM 토큰 사이의 빈 시간을 'preparing' 라벨로 채움.
    // 첫 토큰이 도착하면 stream_chunk 가 다시 'streaming' 으로 갱신.
    dispatch({
      type: 'SET_ACTIVITY',
      activity: { type: 'preparing', label: '준비 중', startedAt: Date.now() },
    })
  },
})
