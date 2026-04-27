import type { Dispatch, MutableRefObject } from 'react'
import { sendToHost } from '../jcef'
import type { AppAction, TimelineEntry, ModelInfo } from '../../store'

export interface IpcHandlerCtx {
  dispatch: Dispatch<AppAction>
  sourceRef: MutableRefObject<'chat' | 'action'>
}

export type IpcHandlerMap = Record<string, (payload: unknown) => void>

// 도구 → 사용자에게 보일 한국어 라벨 (글로벌 활동 표시줄/입력창 placeholder 용)
function getToolActivityLabel(tool: string): string {
  switch (tool) {
    case 'read_file':     return '파일 읽는 중'
    case 'write_file':    return '파일 쓰는 중'
    case 'edit_file':     return '파일 편집 중'
    case 'edit_symbol':   return '심볼 편집 중'
    case 'run_terminal':  return 'Bash 실행 중'
    case 'list_dir':      return '디렉토리 탐색 중'
    case 'glob_tool':     return '파일 검색 중'
    case 'grep_tool':     return '코드 검색 중'
    case 'search_symbol': return '심볼 검색 중'
    case 'fetch_url':     return 'URL 가져오는 중'
    case 'save_memory':   return '메모리 저장 중'
    case 'read_memory':   return '메모리 읽는 중'
    default:              return `${tool} 실행 중`
  }
}

function basenameOf(path?: string): string {
  if (!path) return ''
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1) + '…'
}

// 도구 인자에서 status 라벨에 노출할 핵심 키워드 추출
// 예: run_terminal({command: "pwd"}) → "pwd",  read_file({path: "src/foo.ts"}) → "foo.ts"
function summarizeToolArgs(tool: string, args: unknown): string {
  if (!args || typeof args !== 'object') return ''
  const a = args as Record<string, unknown>
  const MAX = 48
  switch (tool) {
    case 'run_terminal':
      return a.command ? truncate(String(a.command), MAX) : ''
    case 'read_file':
    case 'write_file':
    case 'edit_file':
    case 'edit_symbol':
      return a.path ? truncate(basenameOf(String(a.path)), MAX) : ''
    case 'list_dir':
      return a.path ? truncate(String(a.path), MAX) : ''
    case 'glob_tool':
      return a.pattern ? truncate(String(a.pattern), MAX) : ''
    case 'grep_tool':
      return a.pattern ? `"${truncate(String(a.pattern), MAX - 2)}"` : ''
    case 'search_symbol':
      return a.query ? truncate(String(a.query), MAX) : ''
    case 'fetch_url':
      return a.url ? truncate(String(a.url), MAX) : ''
    case 'save_memory':
    case 'read_memory':
      return a.category ? String(a.category) : (a.query ? truncate(String(a.query), MAX) : '')
    default:
      return ''
  }
}

function buildToolStatusLabel(tool: string, args: unknown): string {
  const base = getToolActivityLabel(tool)
  const summary = summarizeToolArgs(tool, args)
  return summary ? `${base}: ${summary}` : base
}

// Core → Webview 메시지 타입별 핸들러. 순수 dispatch 호출 중심이며 currentSource만 ref로 공유.
export function createIpcHandlers(ctx: IpcHandlerCtx): IpcHandlerMap {
  const { dispatch, sourceRef } = ctx

  // 스트리밍 idle 감지: 마지막 토큰 이후 STREAM_IDLE_THRESHOLD 동안 새 토큰이 없으면
  // status 표시줄을 다시 띄워 사용자에게 "출력이 잠시 멈춤" 을 알림.
  const STREAM_IDLE_THRESHOLD_MS = 3000
  let idleTimerId: ReturnType<typeof setTimeout> | null = null
  const clearIdleTimer = () => {
    if (idleTimerId !== null) {
      clearTimeout(idleTimerId)
      idleTimerId = null
    }
  }
  const armIdleTimer = () => {
    clearIdleTimer()
    idleTimerId = setTimeout(() => {
      dispatch({
        type: 'SET_ACTIVITY',
        activity: { type: 'streaming', label: '응답 대기 중', startedAt: Date.now() },
      })
      idleTimerId = null
    }, STREAM_IDLE_THRESHOLD_MS)
  }

  return {
    // ── 스트림 ────────────────────────────────────────────────
    // [흐름 7-a] LLM 스트리밍 시작 → 현재 응답 출처(chat/action) 기록
    stream_start: (payload) => {
      sourceRef.current = (payload as { source: 'chat' | 'action' }).source
    },
    // [흐름 7-b] 토큰 청크 → store의 STREAM_TOKEN reducer로 타임라인 누적
    stream_chunk: (payload) => {
      // 토큰이 timeline 에 흐르는 동안은 status 표시줄을 비워둠 (사용자가 직접 출력을 봄).
      // 단 마지막 토큰 이후 3초 동안 새 토큰이 없으면 idle timer 가 status 를 다시 띄움.
      dispatch({ type: 'CLEAR_ACTIVITY' })
      armIdleTimer()
      dispatch({
        type: 'STREAM_TOKEN',
        token: (payload as { token: string }).token,
        source: sourceRef.current,
      })
    },
    // [흐름 7-c] iteration 의 LLM 스트림 종료 — isBusy 는 turn_done 까지 유지하여 깜빡임 방지
    stream_end: () => {
      clearIdleTimer()
      dispatch({ type: 'STREAM_END' })
    },
    // 전체 turn 완료 — chat.ts finally 에서 emit. isBusy/activity 정리.
    turn_done: () => {
      clearIdleTimer()
      dispatch({ type: 'SET_BUSY', busy: false })
    },

    // ── 도구 ──────────────────────────────────────────────────
    tool_start: (payload) => {
      clearIdleTimer()
      // 도구 시작 직전 → 이전 스트림을 thinking으로 변환
      dispatch({ type: 'ELEVATE_STREAM_TO_THINKING' })
      const p = payload as { tool: string; args: unknown }
      // 글로벌 활동 표시줄 갱신 (도구별 라벨 + 핵심 인자 요약)
      dispatch({
        type: 'SET_ACTIVITY',
        activity: {
          type: 'tool',
          label: buildToolStatusLabel(p.tool, p.args),
          tool: p.tool,
          startedAt: Date.now(),
        },
      })
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
    // ── 자동 검증 ────────────────────────────────────────────
    verify_start: () => {
      clearIdleTimer()
      // 진행 표시: 글로벌 상태 + timeline 의 활성 verify entry
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
      clearIdleTimer()
      const p = payload as {
        command: string; projectKind: string; passed: boolean
        exitCode: number; output: string; durationMs: number; timedOut: boolean
      }
      dispatch({ type: 'COMPLETE_VERIFY', verify: p })
    },

    // tool_start entry에 result 병합 (별도 entry 생성 안함)
    tool_result: (payload) => {
      clearIdleTimer()
      const p = payload as { tool: string; result: unknown }
      dispatch({ type: 'COMPLETE_TOOL', tool: p.tool, result: p.result })
      // 도구 실행 완료 → 다음 LLM 응답까지 빈 시간이 있으므로 'preparing' 라벨로 전환
      // (LLM 의 첫 토큰이 도착하면 stream_chunk 핸들러가 'streaming' 으로 다시 갱신)
      dispatch({
        type: 'SET_ACTIVITY',
        activity: { type: 'preparing', label: '준비 중', startedAt: Date.now() },
      })
    },

    // ── 사고 ──────────────────────────────────────────────────
    // 정책 (A안):
    // - 진행 중 사고는 timeline 에 표시하지 않음 — status indicator 가 책임지므로 중복 제거
    // - 완료된 사고는 1.5s 이상 + content 가 있는 경우에만 timeline 에 펼침 가능한 행 추가
    //   (추론 모델이 남긴 사고 내용은 사용자에게 가치 있음)
    // - content 없는 단순 시간 표시는 status 가 이미 보여줬으므로 흔적 남기지 않음
    thinking_start: (payload) => {
      clearIdleTimer()
      const p = (payload as { iteration?: number; afterTool?: boolean }) ?? {}
      dispatch({
        type: 'SET_ACTIVITY',
        activity: {
          type: 'thinking',
          label: p.afterTool ? '다음 단계 준비 중' : '생각 중',
          startedAt: Date.now(),
        },
      })
    },
    thinking_end: (payload) => {
      const p = payload as { durationMs: number; content?: string }
      // 사고 내용이 없거나 너무 짧으면 timeline 에 추가하지 않음 (status 만으로 충분)
      if (p.durationMs < 1500 || !p.content) return
      // 추론 모델(예: extended thinking)이 남긴 사고 내용은 펼침 가능한 완료 행으로 보존
      dispatch({
        type: 'ADD_TIMELINE',
        entry: {
          id: Date.now().toString(),
          type: 'thinking',
          durationMs: p.durationMs,
          isActive: false,
          content: p.content,
          timestamp: Date.now(),
        },
      })
    },

    // ── 컨텍스트 / 에러 ───────────────────────────────────────
    context_usage: (payload) => {
      dispatch({ type: 'SET_CONTEXT_USAGE', usage: payload as any })
    },
    error: (payload) => {
      clearIdleTimer()
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
      const p = payload as { modelId: string; contextWindow: number; capabilities?: string[] }
      dispatch({
        type: 'SET_MODEL',
        modelId: p.modelId,
        contextWindow: p.contextWindow,
        capabilities: p.capabilities,
      })
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

    // ── 파일 검색 결과 ───────────────────────────────────────
    file_search_result: (payload) => {
      const p = payload as { files: string[] }
      dispatch({ type: 'SET_FILE_SEARCH_RESULTS', files: p.files })
    },
  }
}
