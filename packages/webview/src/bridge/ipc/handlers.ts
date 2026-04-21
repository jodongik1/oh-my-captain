import type { Dispatch, MutableRefObject } from 'react'
import { sendToHost } from '../jcef'
import type { AppAction, TimelineEntry, ModelInfo } from '../../store'

export interface IpcHandlerCtx {
  dispatch: Dispatch<AppAction>
  sourceRef: MutableRefObject<'chat' | 'action'>
}

export type IpcHandlerMap = Record<string, (payload: unknown) => void>

// Core → Webview 메시지 타입별 핸들러. 순수 dispatch 호출 중심이며 currentSource만 ref로 공유.
export function createIpcHandlers(ctx: IpcHandlerCtx): IpcHandlerMap {
  const { dispatch, sourceRef } = ctx

  return {
    // ── 스트림 ────────────────────────────────────────────────
    // [흐름 7-a] LLM 스트리밍 시작 → 현재 응답 출처(chat/action) 기록
    stream_start: (payload) => {
      sourceRef.current = (payload as { source: 'chat' | 'action' }).source
    },
    // [흐름 7-b] 토큰 청크 → store의 STREAM_TOKEN reducer로 타임라인 누적
    stream_chunk: (payload) => {
      dispatch({
        type: 'STREAM_TOKEN',
        token: (payload as { token: string }).token,
        source: sourceRef.current,
      })
    },
    // [흐름 7-c] 스트리밍 완료 → isBusy 해제, isStreaming 플래그 제거
    stream_end: () => {
      dispatch({ type: 'STREAM_END' })
    },

    // ── 도구 ──────────────────────────────────────────────────
    tool_start: (payload) => {
      // 도구 시작 직전 → 이전 스트림을 thinking으로 변환
      dispatch({ type: 'ELEVATE_STREAM_TO_THINKING' })
      const p = payload as { tool: string; args: unknown }
      const entry: TimelineEntry = {
        id: Date.now().toString() + Math.random(),
        type: 'tool_start',
        tool: p.tool,
        args: p.args,
        timestamp: Date.now(),
        isActive: true,
        startedAt: Date.now(),
      }
      dispatch({ type: 'ADD_TIMELINE', entry })
    },
    // tool_start entry에 result 병합 (별도 entry 생성 안함)
    tool_result: (payload) => {
      const p = payload as { tool: string; result: unknown }
      dispatch({ type: 'COMPLETE_TOOL', tool: p.tool, result: p.result })
    },

    // ── 사고 ──────────────────────────────────────────────────
    thinking_start: () => {
      dispatch({
        type: 'ADD_TIMELINE',
        entry: {
          id: Date.now().toString(),
          type: 'thinking',
          durationMs: 0,
          isActive: true,
          startedAt: Date.now(),
          timestamp: Date.now(),
        },
      })
    },
    thinking_end: (payload) => {
      const p = payload as { durationMs: number; content?: string }
      dispatch({ type: 'COMPLETE_THINKING', durationMs: p.durationMs, content: p.content })
    },

    // ── 컨텍스트 / 에러 ───────────────────────────────────────
    context_usage: (payload) => {
      dispatch({ type: 'SET_CONTEXT_USAGE', usage: payload as any })
    },
    error: (payload) => {
      const p = payload as { message: string }
      dispatch({ type: 'ADD_ERROR', message: p.message })
    },

    // ── 세션 ──────────────────────────────────────────────────
    sessions_list: (payload) => {
      const p = payload as { sessions: any[] }
      dispatch({ type: 'SET_SESSIONS', sessions: p.sessions })
    },
    session_history: (payload) => {
      const p = payload as { messages: any[] }
      for (const m of p.messages) {
        if (m.role === 'user') {
          dispatch({
            type: 'ADD_TIMELINE',
            entry: { id: m.id, type: 'user', content: m.content, timestamp: m.timestamp },
          })
        } else if (m.role === 'assistant') {
          dispatch({
            type: 'ADD_TIMELINE',
            entry: { id: m.id, type: 'stream', content: m.content, timestamp: m.timestamp },
          })
        }
      }
    },

    // ── 모델 ──────────────────────────────────────────────────
    model_list_result: (payload) => {
      const p = payload as { models: ModelInfo[]; currentModel: string }
      dispatch({ type: 'SET_AVAILABLE_MODELS', models: p.models })
      dispatch({ type: 'SET_MODEL', modelId: p.currentModel })
    },
    model_switched: (payload) => {
      const p = payload as { modelId: string; contextWindow: number }
      dispatch({ type: 'SET_MODEL', modelId: p.modelId, contextWindow: p.contextWindow })
    },

    // ── 설정 / 부트스트랩 ─────────────────────────────────────
    core_ready: () => {
      sendToHost({ type: 'settings_get', payload: {} })
      sendToHost({ type: 'session_list', payload: {} })
    },
    settings_loaded: (payload) => {
      const p = payload as { settings: any; isFirstTime: boolean }
      console.log('[REACT IPC DEBUG] settings_loaded RECEIVED:', JSON.stringify(payload))
      dispatch({ type: 'SETTINGS_LOADED', isConfigured: !p.isFirstTime, settings: p.settings })
      if (p.settings?.cachedModels?.length) {
        dispatch({ type: 'SET_AVAILABLE_MODELS', models: p.settings.cachedModels })
      }
    },

    // ── 승인 ──────────────────────────────────────────────────
    approval_request: (payload) => {
      const p = payload as {
        id: string
        action: string
        description: string
        risk: 'low' | 'medium' | 'high'
        details?: unknown
      }
      const entry: TimelineEntry = {
        id: p.id,
        type: 'approval',
        timestamp: Date.now(),
        isActive: true,
        approval: {
          requestId: p.id,
          action: p.action,
          description: p.description,
          risk: p.risk,
          details: p.details,
        },
      }
      dispatch({ type: 'ADD_APPROVAL', entry })
    },
  }
}
