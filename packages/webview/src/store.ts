import { useReducer, Dispatch } from 'react'
import type { SessionSummary, ModelInfo, CaptainSettings } from '@omc/protocol'

// 다른 webview 모듈은 여전히 `import { SessionSummary } from '../store'` 형태로 가져온다 — 호환 re-export.
export type { SessionSummary, ModelInfo, CaptainSettings } from '@omc/protocol'

export type Mode = 'plan' | 'ask' | 'auto'

export interface ApprovalInfo {
  requestId: string
  action: string
  description: string
  risk: 'low' | 'medium' | 'high'
  details?: unknown
  resolved?: boolean
  approved?: boolean
}

/**
 * 사용자 메시지에 첨부되는 멀티모달 콘텐츠.
 * 현재는 이미지만 지원 (멀티모달 모델일 때만 전송됨).
 */
export interface Attachment {
  kind: 'image'
  mediaType: string  // 예: 'image/jpeg', 'image/png'
  data: string       // base64 (no data: prefix)
  filename?: string
  /** UI 썸네일에 쓸 data URL (직접 string 으로 보관해 변환 비용 회피) */
  dataUrl: string
  /** 원본 픽셀 크기 — 첨부 카드에 "947×147" 형태로 노출 */
  width?: number
  height?: number
  /** 원본 파일 크기 (bytes) */
  size?: number
}

export interface VerifyInfo {
  command: string
  projectKind: string
  passed: boolean
  exitCode?: number
  output?: string
  durationMs?: number
  timedOut?: boolean
  /** 'env' 면 빌드 환경 문제 — 사용자에게 노란 톤으로 안내 */
  failureKind?: 'code' | 'env'
}

/**
 * 타임라인 엔트리 — type 별로 가지는 필드가 명확히 다르므로 discriminated union 으로 정의.
 * 공통 필드(id/timestamp/interrupted) 만 base 에 두고, type-specific 필드는 각 변형에 둔다.
 */
interface TimelineBase {
  id: string
  timestamp: number
  /** 사용자 abort 로 중단된 entry 는 회색 dot + retry CTA 로 표시 */
  interrupted?: boolean
}

export type TimelineEntry =
  | (TimelineBase & {
      type: 'user'
      content: string
      attachments?: Attachment[]
    })
  | (TimelineBase & {
      type: 'stream'
      /** 'chat' | 'action' — 일반 채팅 vs 코드 액션 응답 (UI 분기용) */
      source?: 'chat' | 'action'
      content: string
      isStreaming?: boolean
    })
  | (TimelineBase & {
      type: 'tool_start'
      tool: string
      args: unknown
      result?: unknown
      isActive?: boolean
      startedAt?: number
    })
  | (TimelineBase & {
      type: 'tool_result'
      tool: string
      result: unknown
    })
  | (TimelineBase & {
      type: 'thinking'
      content?: string
      durationMs?: number
      isActive?: boolean
    })
  | (TimelineBase & {
      type: 'error'
      content: string
    })
  | (TimelineBase & {
      type: 'approval'
      approval: ApprovalInfo
      isActive?: boolean
    })
  | (TimelineBase & {
      type: 'verify'
      verify?: VerifyInfo
      isActive?: boolean
      durationMs?: number
      startedAt?: number
    })
  | (TimelineBase & {
      type: 'interrupted'
    })

export interface ActivityState {
  type: 'thinking' | 'streaming' | 'tool' | 'preparing'
  label: string         // 사용자에게 보일 한국어 라벨 (예: "생각 중", "Bash 실행 중")
  tool?: string         // type === 'tool' 인 경우 도구 이름
  startedAt: number     // 활동 시작 ms (경과 시간 계산용)
}

export interface AppState {
  mode: Mode
  sessionId: string | null
  sessionTitle: string
  timeline: TimelineEntry[]
  sessions: SessionSummary[]
  isBusy: boolean
  currentActivity: ActivityState | null  // 항상 살아있는 글로벌 상태 표시줄용
  showSettings: boolean
  showHistory: boolean
  contextUsage: { usedTokens: number; maxTokens: number; percentage: number }
  currentModel: string
  /** core 가 provider API 로 받아온 현재 모델의 capability — 'vision' 등 */
  currentModelCapabilities: string[]
  availableModels: ModelInfo[]
  slashFilter: string | null   // null = 팝업 닫힘
  showModelSelector: boolean
  isConfigured: boolean | null // null = 하직 로드 전, false = 미설정 온보딩
  settings: CaptainSettings | null
  fileSearchResults: string[]
  pendingAttachments: Attachment[]   // 다음 메시지에 첨부될 이미지들
}

export type AppAction =
  | { type: 'SET_MODE'; mode: Mode }
  | { type: 'SET_BUSY'; busy: boolean }
  | { type: 'STREAM_TOKEN'; token: string; source?: 'chat' | 'action' }
  | { type: 'STREAM_END' }
  | { type: 'ADD_TIMELINE'; entry: TimelineEntry }
  | { type: 'UPDATE_LAST_STREAM'; token: string }
  | { type: 'SET_SESSIONS'; sessions: SessionSummary[] }
  | { type: 'SELECT_SESSION'; sessionId: string; title: string }
  | { type: 'NEW_SESSION' }
  | { type: 'TOGGLE_SETTINGS' }
  | { type: 'TOGGLE_HISTORY' }
  | { type: 'SET_CONTEXT_USAGE'; usage: AppState['contextUsage'] }
  | { type: 'SET_MODEL'; modelId: string; contextWindow?: number; capabilities?: string[] }
  | { type: 'SET_AVAILABLE_MODELS'; models: ModelInfo[] }
  | { type: 'SET_SLASH_FILTER'; filter: string | null }
  | { type: 'TOGGLE_MODEL_SELECTOR' }
  | { type: 'ADD_ERROR'; message: string }
  | { type: 'RENAME_SESSION'; sessionId: string; title: string }
  | { type: 'DELETE_SESSION'; sessionId: string }
  | { type: 'COMPLETE_THINKING'; durationMs: number; content?: string }
  | { type: 'DROP_LAST_THINKING' }
  | { type: 'COMPLETE_TOOL'; tool: string; result: unknown }
  | { type: 'PRUNE_PREAMBLE' }
  | { type: 'SETTINGS_LOADED'; isConfigured: boolean; settings: CaptainSettings }
  | { type: 'ADD_APPROVAL'; entry: TimelineEntry }
  | { type: 'RESOLVE_APPROVAL'; requestId: string; approved: boolean }
  | { type: 'ELEVATE_STREAM_TO_THINKING' }
  | { type: 'SET_FILE_SEARCH_RESULTS'; files: string[] }
  | { type: 'SET_ACTIVITY'; activity: ActivityState }
  | { type: 'CLEAR_ACTIVITY' }
  | { type: 'COMPLETE_VERIFY'; verify: VerifyInfo }
  | { type: 'MARK_INTERRUPTED' }
  | { type: 'ADD_ATTACHMENTS'; attachments: Attachment[] }
  | { type: 'REMOVE_ATTACHMENT'; index: number }
  | { type: 'CLEAR_ATTACHMENTS' }

export const initialState: AppState = {
  mode: 'ask',
  sessionId: null,
  sessionTitle: 'New Session',
  timeline: [],
  sessions: [],
  isBusy: false,
  currentActivity: null,
  showSettings: false,
  showHistory: false,
  contextUsage: { usedTokens: 0, maxTokens: 32768, percentage: 0 },
  currentModel: 'qwen3-coder:30b',
  currentModelCapabilities: [],
  availableModels: [],
  slashFilter: null,
  showModelSelector: false,
  isConfigured: null,
  settings: null,
  fileSearchResults: [],
  pendingAttachments: [],
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_MODE':
      return { ...state, mode: action.mode }

    case 'SET_BUSY':
      // busy 가 false 가 되면 글로벌 활동 표시도 함께 정리
      return { ...state, isBusy: action.busy, ...(action.busy ? {} : { currentActivity: null }) }

    case 'STREAM_TOKEN': {
      // [흐름 7-b] App.tsx의 stream_chunk 핸들러로부터 호출됨
      // LLM이 토큰을 스트리밍할 때마다 이 reducer가 실행되어 타임라인을 실시간 갱신
      const last = state.timeline[state.timeline.length - 1]
      if (last?.type === 'stream' && last.isStreaming) {
        // 이미 스트리밍 중인 엔트리가 있으면 content에 토큰을 누적 (새 엔트리 생성 안 함)
        const updated = { ...last, content: (last.content ?? '') + action.token }
        return { ...state, timeline: [...state.timeline.slice(0, -1), updated] }
      }
      // 스트리밍 엔트리가 없으면 새 stream 엔트리를 생성하여 타임라인에 추가
      return {
        ...state,
        isBusy: true,
        timeline: [...state.timeline, {
          id: Date.now().toString(),
          type: 'stream',
          source: action.source,  // 'chat' | 'action' (코드 액션 구분용)
          content: action.token,
          isStreaming: true,       // 스트리밍 진행 중 플래그 (완료 후 false로 전환)
          timestamp: Date.now()
        }]
      }
    }

    case 'STREAM_END': {
      // [흐름 7-c] stream_end 수신 → 마지막 stream 엔트리의 isStreaming을 false로 전환하고 isBusy 해제
      // 단, 도구 호출이 이어지는 LLM 응답이면 isBusy/activity 는 유지 (다음 turn 까지)
      const last = state.timeline[state.timeline.length - 1]
      if (last?.type === 'stream') {
        const updated = { ...last, isStreaming: false }
        return { ...state, timeline: [...state.timeline.slice(0, -1), updated] }
      }
      return state
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

    case 'SET_MODEL': {
      // capabilities 가 액션에 명시되면 우선 사용, 없으면 availableModels 에서 찾기
      const fromList = state.availableModels.find(m => m.id === action.modelId)?.capabilities
      const nextCaps = action.capabilities ?? fromList ?? state.currentModelCapabilities
      return {
        ...state,
        currentModel: action.modelId,
        currentModelCapabilities: nextCaps,
        contextUsage: action.contextWindow
          ? { ...state.contextUsage, maxTokens: action.contextWindow }
          : state.contextUsage,
        settings: state.settings ? {
          ...state.settings,
          provider: { ...state.settings.provider, ollamaModel: action.modelId },
          ...(action.contextWindow ? { model: { ...state.settings.model, contextWindow: action.contextWindow } } : {})
        } : state.settings,
      }
    }

    case 'SET_AVAILABLE_MODELS': {
      // 모델 목록 갱신 시 currentModel 의 capabilities 도 자동 반영
      const matched = action.models.find(m => m.id === state.currentModel)?.capabilities
      return {
        ...state,
        availableModels: action.models,
        currentModelCapabilities: matched ?? state.currentModelCapabilities,
      }
    }

    case 'SET_SLASH_FILTER':
      // 동일 값으로의 setState 가드 — 채팅 입력은 매 키 입력마다 (대부분 null → null) 호출되므로
      // 새 state 객체를 만들면 App 전체가 re-render 되어 Timeline / Mermaid 비용이 발생한다.
      if (state.slashFilter === action.filter && (action.filter === null || !state.showModelSelector)) return state
      return { ...state, slashFilter: action.filter, ...(action.filter !== null ? { showModelSelector: false } : {}) }

    case 'TOGGLE_MODEL_SELECTOR':
      return { ...state, showModelSelector: !state.showModelSelector, slashFilter: null }

    case 'ADD_ERROR':
      return {
        ...state,
        isBusy: false,
        currentActivity: null,
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
        const target = state.timeline[tIdx]
        if (target.type !== 'thinking') return state  // narrowing (이미 findLastIndex 가 보장)
        const updated: TimelineEntry = {
          ...target,
          durationMs: action.durationMs,
          isActive: false,
          content: action.content,
        }
        return {
          ...state,
          timeline: [...state.timeline.slice(0, tIdx), updated, ...state.timeline.slice(tIdx + 1)]
        }
      }
      return state
    }

    case 'DROP_LAST_THINKING': {
      // 마지막 active thinking entry 가 있으면 제거 (짧아서 사용자에게 보여줄 가치 없음)
      const tIdx = findLastIndex(state.timeline, e => e.type === 'thinking' && e.isActive === true)
      if (tIdx >= 0) {
        return {
          ...state,
          timeline: [...state.timeline.slice(0, tIdx), ...state.timeline.slice(tIdx + 1)]
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
        const target = state.timeline[toolIdx]
        if (target.type !== 'tool_start') return state
        const updated: TimelineEntry = {
          ...target,
          result: action.result,
          isActive: false,
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
        e => e.type === 'approval' && e.approval.requestId === action.requestId
      )
      if (aIdx >= 0) {
        const target = state.timeline[aIdx]
        if (target.type !== 'approval') return state
        const updated: TimelineEntry = {
          ...target,
          isActive: false,
          approval: {
            ...target.approval,
            resolved: true,
            approved: action.approved,
          },
        }
        return {
          ...state,
          timeline: [...state.timeline.slice(0, aIdx), updated, ...state.timeline.slice(aIdx + 1)]
        }
      }
      return state
    }

    case 'ELEVATE_STREAM_TO_THINKING': {
      // 도구 호출 직전의 stream 이 짧은 preamble (안내문) 이면 thinking 으로 승격하지 않고 제거.
      // 본문성 stream (분석/설명) 은 그대로 보존하여 Claude 와 같은 자연스러운 흐름 유지.
      const lastEntry = state.timeline[state.timeline.length - 1]
      if (lastEntry?.type === 'stream' && !lastEntry.isStreaming) {
        if (isPreamble(lastEntry.content)) {
          return { ...state, timeline: state.timeline.slice(0, -1) }
        }
      }
      return state
    }

    case 'SET_FILE_SEARCH_RESULTS':
      return { ...state, fileSearchResults: action.files }

    case 'SET_ACTIVITY': {
      // 같은 type 으로 연속 갱신될 때는 startedAt 을 유지하여 경과 시간이 리셋되지 않도록 함.
      // 도구가 바뀐 경우(tool 이름 변경) 는 새 startedAt 을 사용.
      const prev = state.currentActivity
      const next = action.activity
      if (
        prev &&
        prev.type === next.type &&
        prev.tool === next.tool &&
        prev.label === next.label
      ) {
        return state
      }
      return { ...state, currentActivity: next }
    }

    case 'CLEAR_ACTIVITY':
      // 매 토큰마다 dispatch 되어도 이미 null 이면 같은 state 를 반환하여 re-render 방지
      if (state.currentActivity === null) return state
      return { ...state, currentActivity: null }

    case 'ADD_ATTACHMENTS':
      return { ...state, pendingAttachments: [...state.pendingAttachments, ...action.attachments] }

    case 'REMOVE_ATTACHMENT':
      return {
        ...state,
        pendingAttachments: state.pendingAttachments.filter((_, i) => i !== action.index),
      }

    case 'CLEAR_ATTACHMENTS':
      if (state.pendingAttachments.length === 0) return state
      return { ...state, pendingAttachments: [] }

    case 'MARK_INTERRUPTED': {
      // 진행 중이던 entry 들(stream/tool_start/thinking/verify/approval) 을 interrupted 로 마크.
      // 마지막에 별도 'interrupted' entry 를 추가하여 사용자에게 중단을 명시 + retry 옵션 제공.
      const updated: TimelineEntry[] = state.timeline.map(e => {
        if (e.type === 'stream' && e.isStreaming) {
          return { ...e, isStreaming: false, interrupted: true }
        }
        if ((e.type === 'tool_start' || e.type === 'thinking' || e.type === 'verify' || e.type === 'approval') && e.isActive) {
          return { ...e, isActive: false, interrupted: true }
        }
        return e
      })
      return {
        ...state,
        timeline: [...updated, {
          id: Date.now().toString() + Math.random(),
          type: 'interrupted',
          timestamp: Date.now(),
        }],
        currentActivity: null,
      }
    }

    case 'COMPLETE_VERIFY': {
      // 마지막에 진행 중인 verify entry 가 있으면 완료 처리, 없으면 새로 추가.
      // (skip 결과는 timeline 에 추가하지 않음)
      if (action.verify.command === '(skip)') return state
      const idx = findLastIndex(state.timeline, e => e.type === 'verify' && e.isActive === true)
      if (idx >= 0) {
        const target = state.timeline[idx]
        if (target.type !== 'verify') return state
        const updated: TimelineEntry = {
          ...target,
          isActive: false,
          durationMs: action.verify.durationMs,
          verify: action.verify,
        }
        return { ...state, timeline: [...state.timeline.slice(0, idx), updated, ...state.timeline.slice(idx + 1)] }
      }
      return {
        ...state,
        timeline: [...state.timeline, {
          id: Date.now().toString() + Math.random(),
          type: 'verify',
          isActive: false,
          durationMs: action.verify.durationMs,
          timestamp: Date.now(),
          verify: action.verify,
        }],
      }
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
