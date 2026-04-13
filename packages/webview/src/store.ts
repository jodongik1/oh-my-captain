import { useReducer, Dispatch } from 'react'

export type Mode = 'plan' | 'ask' | 'auto'

export interface SessionSummary {
  id: string
  title: string
  updatedAt: number
  messageCount: number
  preview: string
}

export interface ModelInfo {
  id: string
  name: string
  contextWindow?: number
}

export interface ApprovalInfo {
  requestId: string
  action: string
  description: string
  risk: 'low' | 'medium' | 'high'
  details?: unknown
  resolved?: boolean
  approved?: boolean
}

export interface TimelineEntry {
  id: string
  type: 'user' | 'stream' | 'tool_start' | 'tool_result' | 'thinking' | 'error' | 'approval'
  content?: string
  tool?: string
  args?: unknown
  result?: unknown
  durationMs?: number
  timestamp: number
  isStreaming?: boolean
  isActive?: boolean       // 현재 진행 중 여부 (dot 애니메이션용)
  startedAt?: number       // 도구 시작 시간 (소요시간 계산용)
  approval?: ApprovalInfo  // approval 타입 전용
}

export interface AppState {
  mode: Mode
  sessionId: string | null
  sessionTitle: string
  timeline: TimelineEntry[]
  sessions: SessionSummary[]
  isBusy: boolean
  showSettings: boolean
  showHistory: boolean
  contextUsage: { usedTokens: number; maxTokens: number; percentage: number }
  currentModel: string
  availableModels: ModelInfo[]
  slashFilter: string | null   // null = 팝업 닫힘
  showModelSelector: boolean
  isConfigured: boolean | null // null = 하직 로드 전, false = 미설정 온보딩
  settings: any | null         // CaptainSettings 타입 (store에서는 any 표기)
}

export type AppAction =
  | { type: 'SET_MODE'; mode: Mode }
  | { type: 'SET_BUSY'; busy: boolean }
  | { type: 'STREAM_TOKEN'; token: string }
  | { type: 'STREAM_END' }
  | { type: 'ADD_TIMELINE'; entry: TimelineEntry }
  | { type: 'UPDATE_LAST_STREAM'; token: string }
  | { type: 'SET_SESSIONS'; sessions: SessionSummary[] }
  | { type: 'SELECT_SESSION'; sessionId: string; title: string }
  | { type: 'NEW_SESSION' }
  | { type: 'TOGGLE_SETTINGS' }
  | { type: 'TOGGLE_HISTORY' }
  | { type: 'SET_CONTEXT_USAGE'; usage: AppState['contextUsage'] }
  | { type: 'SET_MODEL'; modelId: string; contextWindow?: number }
  | { type: 'SET_AVAILABLE_MODELS'; models: ModelInfo[] }
  | { type: 'SET_SLASH_FILTER'; filter: string | null }
  | { type: 'TOGGLE_MODEL_SELECTOR' }
  | { type: 'ADD_ERROR'; message: string }
  | { type: 'RENAME_SESSION'; sessionId: string; title: string }
  | { type: 'DELETE_SESSION'; sessionId: string }
  | { type: 'COMPLETE_THINKING'; durationMs: number; content?: string }
  | { type: 'COMPLETE_TOOL'; tool: string; result: unknown }
  | { type: 'PRUNE_PREAMBLE' }
  | { type: 'SETTINGS_LOADED'; isConfigured: boolean; settings: any }
  | { type: 'ADD_APPROVAL'; entry: TimelineEntry }
  | { type: 'RESOLVE_APPROVAL'; requestId: string; approved: boolean }

export const initialState: AppState = {
  mode: 'ask',
  sessionId: null,
  sessionTitle: 'New Session',
  timeline: [],
  sessions: [],
  isBusy: false,
  showSettings: false,
  showHistory: false,
  contextUsage: { usedTokens: 0, maxTokens: 32768, percentage: 0 },
  currentModel: 'qwen3-coder:30b',
  availableModels: [],
  slashFilter: null,
  showModelSelector: false,
  isConfigured: null,
  settings: null,
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_MODE':
      return { ...state, mode: action.mode }

    case 'SET_BUSY':
      return { ...state, isBusy: action.busy }

    case 'STREAM_TOKEN': {
      // 마지막 stream 엔트리에 토큰 추가 (없으면 새로 생성)
      const last = state.timeline[state.timeline.length - 1]
      if (last?.type === 'stream' && last.isStreaming) {
        const updated = { ...last, content: (last.content ?? '') + action.token }
        return { ...state, timeline: [...state.timeline.slice(0, -1), updated] }
      }
      return {
        ...state,
        isBusy: true,
        timeline: [...state.timeline, {
          id: Date.now().toString(),
          type: 'stream',
          content: action.token,
          isStreaming: true,
          timestamp: Date.now()
        }]
      }
    }

    case 'STREAM_END': {
      const last = state.timeline[state.timeline.length - 1]
      if (last?.type === 'stream') {
        const updated = { ...last, isStreaming: false }
        return { ...state, isBusy: false, timeline: [...state.timeline.slice(0, -1), updated] }
      }
      return { ...state, isBusy: false }
    }

    case 'ADD_TIMELINE':
      return { ...state, timeline: [...state.timeline, action.entry] }

    case 'SET_SESSIONS':
      return { ...state, sessions: action.sessions }

    case 'SELECT_SESSION':
      return {
        ...state,
        sessionId: action.sessionId,
        sessionTitle: action.title,
        timeline: [],
        showHistory: false
      }

    case 'NEW_SESSION':
      return {
        ...state,
        sessionId: null,
        sessionTitle: 'New Session',
        timeline: [],
        showHistory: false,
        slashFilter: null
      }

    case 'TOGGLE_SETTINGS':
      return { ...state, showSettings: !state.showSettings, showHistory: false }

    case 'TOGGLE_HISTORY':
      return { ...state, showHistory: !state.showHistory, showSettings: false }

    case 'SET_CONTEXT_USAGE':
      return { ...state, contextUsage: action.usage }

    case 'SET_MODEL':
      return {
        ...state,
        currentModel: action.modelId,
        contextUsage: action.contextWindow
          ? { ...state.contextUsage, maxTokens: action.contextWindow }
          : state.contextUsage
      }

    case 'SET_AVAILABLE_MODELS':
      return { ...state, availableModels: action.models }

    case 'SET_SLASH_FILTER':
      return { ...state, slashFilter: action.filter, showModelSelector: false }

    case 'TOGGLE_MODEL_SELECTOR':
      return { ...state, showModelSelector: !state.showModelSelector, slashFilter: null }

    case 'ADD_ERROR':
      return {
        ...state,
        isBusy: false,
        timeline: [...state.timeline, {
          id: Date.now().toString(),
          type: 'error',
          content: action.message,
          timestamp: Date.now()
        }]
      }

    case 'COMPLETE_THINKING': {
      // 마지막 active thinking entry를 찾아서 완료 처리
      const tIdx = findLastIndex(state.timeline, e => e.type === 'thinking' && e.isActive === true)
      if (tIdx >= 0) {
        const updated = {
          ...state.timeline[tIdx],
          durationMs: action.durationMs,
          isActive: false,
          content: action.content
        }
        return {
          ...state,
          timeline: [...state.timeline.slice(0, tIdx), updated, ...state.timeline.slice(tIdx + 1)]
        }
      }
      return state
    }

    case 'COMPLETE_TOOL': {
      // 마지막 매칭되는 active tool_start entry에 result 병합
      const toolIdx = findLastIndex(
        state.timeline,
        e => e.type === 'tool_start' && e.tool === action.tool && e.isActive === true
      )
      if (toolIdx >= 0) {
        const updated = {
          ...state.timeline[toolIdx],
          result: action.result,
          isActive: false
        }
        return {
          ...state,
          timeline: [...state.timeline.slice(0, toolIdx), updated, ...state.timeline.slice(toolIdx + 1)]
        }
      }
      return state
    }

    case 'RENAME_SESSION':
      return {
        ...state,
        sessions: state.sessions.map(s =>
          s.id === action.sessionId ? { ...s, title: action.title } : s
        ),
        sessionTitle: state.sessionId === action.sessionId ? action.title : state.sessionTitle
      }

    case 'DELETE_SESSION':
      return {
        ...state,
        sessions: state.sessions.filter(s => s.id !== action.sessionId),
        ...(state.sessionId === action.sessionId
          ? { sessionId: null, sessionTitle: 'New Session', timeline: [] }
          : {})
      }

    case 'PRUNE_PREAMBLE': {
      // 도구 시작 직전, 마지막 stream이 짧은 preamble이면 제거
      const lastEntry = state.timeline[state.timeline.length - 1]
      if (lastEntry?.type === 'stream' && !lastEntry.isStreaming && isPreamble(lastEntry.content)) {
        return { ...state, timeline: state.timeline.slice(0, -1) }
      }
      return state
    }

    case 'SETTINGS_LOADED': {
      return {
        ...state,
        isConfigured: action.isConfigured,
        settings: action.settings,
        currentModel: action.settings?.provider?.ollamaModel || state.currentModel
      }
    }

    case 'ADD_APPROVAL':
      return { ...state, timeline: [...state.timeline, action.entry] }

    case 'RESOLVE_APPROVAL': {
      const aIdx = findLastIndex(
        state.timeline,
        e => e.type === 'approval' && e.approval?.requestId === action.requestId
      )
      if (aIdx >= 0) {
        const updated = {
          ...state.timeline[aIdx],
          isActive: false,
          approval: {
            ...state.timeline[aIdx].approval!,
            resolved: true,
            approved: action.approved,
          }
        }
        return {
          ...state,
          timeline: [...state.timeline.slice(0, aIdx), updated, ...state.timeline.slice(aIdx + 1)]
        }
      }
      return state
    }

    default:
      return state
  }
}

// findLastIndex polyfill
function findLastIndex<T>(arr: T[], pred: (item: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (pred(arr[i])) return i
  }
  return -1
}

/**
 * 도구 호출 직전의 짧은 안내 메시지(preamble) 판별.
 * 
 * 두 가지 기준:
 * (A) 매우 짧은 텍스트(2줄 이하, 120자 이내) + 동작 키워드 → 확실한 preamble
 * (B) 3줄 이하 + 파일명/확장자 포함 + 동작 키워드 → preamble
 */
function isPreamble(content?: string): boolean {
  if (!content) return false
  const text = content.trim()
  const lines = text.split('\n').filter(Boolean)
  if (lines.length > 3) return false
  if (text.length > 300) return false

  // 동작 키워드 (한국어 + 영어): 도구 사용 안내 문구에서 흔히 나오는 표현
  const actionKeywords = /확인|살펴|읽어|열어|분석|검토|체크|파악|보겠|하겠|look|read|check|open|examine|inspect|review|see|view|analyze|let me|let's|먼저|다음으로|이제|시작/i
  const hasActionKeyword = actionKeywords.test(text)

  // (A) 매우 짧은 텍스트 + 동작 키워드 → 확실한 preamble
  if (lines.length <= 2 && text.length <= 120 && hasActionKeyword) {
    return true
  }

  // (B) 파일명/확장자 포함 + 동작 키워드
  const hasFileRef = /\.[a-zA-Z]{1,6}\b/.test(text) &&
    /\.(java|kt|ts|tsx|js|jsx|py|go|rs|rb|swift|c|cpp|h|css|html|xml|json|yaml|yml|gradle|properties|sql|md|sh|toml)\b/i.test(text)

  return hasFileRef && hasActionKeyword
}

export function useAppStore(): [AppState, Dispatch<AppAction>] {
  return useReducer(appReducer, initialState)
}
