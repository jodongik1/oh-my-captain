// 스트림/사고 도메인 핸들러.
// 책임: stream_start/chunk/end · turn_done · thinking_start/end · context_usage · error · verify_*

import type { IpcHandlerFactory } from '../types'
import { createStreamIdleTimer } from '../streamIdleTimer'
import type { TimelineEntry } from '../../../store'

export const createStreamHandlers: IpcHandlerFactory = (ctx) => {
  const { dispatch, sourceRef } = ctx
  const idle = createStreamIdleTimer(dispatch)

  return {
    // ── 스트림 ──────────────────────────────────────────────
    stream_start: (payload) => {
      sourceRef.current = payload.source
    },
    stream_chunk: (payload) => {
      // 토큰이 흐르는 동안 status 비움. 마지막 토큰 후 idle 타이머가 다시 띄움.
      dispatch({ type: 'CLEAR_ACTIVITY' })
      idle.arm()
      dispatch({ type: 'STREAM_TOKEN', token: payload.token, source: sourceRef.current })
    },
    stream_end: () => {
      idle.clear()
      dispatch({ type: 'STREAM_END' })
    },
    turn_done: () => {
      idle.clear()
      dispatch({ type: 'SET_BUSY', busy: false })
    },

    // ── 사고 ────────────────────────────────────────────────
    thinking_start: (payload) => {
      idle.clear()
      dispatch({
        type: 'SET_ACTIVITY',
        activity: {
          type: 'thinking',
          label: payload?.afterTool ? '다음 단계 준비 중' : '생각 중',
          startedAt: Date.now(),
        },
      })
    },
    thinking_end: (payload) => {
      // content 가 없거나 1.5s 미만의 짧은 사고는 timeline 에 흔적 남기지 않음 (status 만으로 충분).
      // 추론 모델이 남긴 사고는 펼침 가능한 행으로 보존.
      if (payload.durationMs < 1500 || !payload.content) return
      const entry: TimelineEntry = {
        id: Date.now().toString(),
        type: 'thinking',
        durationMs: payload.durationMs,
        isActive: false,
        content: payload.content,
        timestamp: Date.now(),
      }
      dispatch({ type: 'ADD_TIMELINE', entry })
    },

    // ── 컨텍스트 / 에러 ────────────────────────────────────
    context_usage: (payload) => {
      dispatch({ type: 'SET_CONTEXT_USAGE', usage: payload })
    },
    error: (payload) => {
      idle.clear()
      dispatch({ type: 'ADD_ERROR', message: payload.message })
    },

    // ── 자동 검증 ──────────────────────────────────────────
    verify_start: () => {
      idle.clear()
      dispatch({
        type: 'SET_ACTIVITY',
        activity: { type: 'tool', label: '코드 검증 중', tool: 'verify', startedAt: Date.now() },
      })
      dispatch({
        type: 'ADD_TIMELINE',
        entry: {
          id: Date.now().toString() + Math.random(),
          type: 'verify',
          isActive: true,
          startedAt: Date.now(),
          timestamp: Date.now(),
          verify: { command: 'auto', projectKind: '', passed: false },
        },
      })
    },
    verify_result: (payload) => {
      idle.clear()
      dispatch({ type: 'COMPLETE_VERIFY', verify: payload })
    },
  }
}
