import { startServer, registerHandler, send } from './ipc/server.js'
import { IpcHostAdapter } from './host/ipc_adapter.js'
import { OllamaProvider, fetchOllamaModels, fetchOllamaModelInfo } from './providers/ollama.js'
import { OpenAIProvider } from './providers/openai.js'
import { AnthropicProvider } from './providers/anthropic.js'
import { runLoop, abortLoop } from './agent/loop.js'
import { executeCodeAction } from './actions/handler.js'
import { DEFAULT_SETTINGS } from './settings/types.js'
import { SettingsManager } from './settings/manager.js'
import * as sessionDb from './db/session.js'
import type { LLMProvider, Message } from './providers/types.js'
import type { InitPayload, CaptainSettings } from './ipc/protocol.js'

// 프로세스 크래시 방지
process.on('unhandledRejection', (reason) => {
  console.error('[Core] Unhandled rejection:', reason)
})
process.on('uncaughtException', (err) => {
  console.error('[Core] Uncaught exception:', err)
})

// ── 단일 상태 객체 ──────────────────────────────────────────
interface CoreState {
  host: IpcHostAdapter | null
  provider: LLMProvider | null
  settings: CaptainSettings
  sessionId: string | null
  history: Message[]
  busy: boolean
}

const state: CoreState = {
  host: null,
  provider: null,
  settings: DEFAULT_SETTINGS as unknown as CaptainSettings,
  sessionId: null,
  history: [],
  busy: false,
}

// ── Provider 생성 ────────────────────────────────────────────
function createProvider(s: CaptainSettings): LLMProvider {
  const timeout = s.model.requestTimeoutMs
  const ctx = s.model.contextWindow

  switch (s.provider.provider) {
    case 'openai':
      return new OpenAIProvider({
        model: s.provider.openAiModel,
        apiKey: s.provider.openAiApiKey,
        baseUrl: s.provider.openAiBaseUrl,
        contextWindow: ctx,
        requestTimeoutMs: timeout,
      })
    case 'anthropic':
      return new AnthropicProvider({
        model: s.provider.anthropicModel,
        apiKey: s.provider.anthropicApiKey,
        contextWindow: ctx,
        requestTimeoutMs: timeout,
      })
    case 'ollama':
    default:
      return new OllamaProvider({
        model: s.provider.ollamaModel,
        baseUrl: s.provider.ollamaBaseUrl,
        apiKey: s.provider.ollamaApiKey || undefined,
        contextWindow: ctx,
        requestTimeoutMs: timeout,
      })
  }
}

// ── 도구 등록 (import side effect) ───────────────────────────
import './tools/read_file.js'
import './tools/write_file.js'
import './tools/run_terminal.js'

// ── IPC 서버 시작 ────────────────────────────────────────────
startServer(() => {
  console.error('[Core] IPC 서버 대기 중...')
})

// ── 핸들러 등록 ──────────────────────────────────────────────

registerHandler('init', (msg) => {
  const payload = msg.payload as InitPayload
  state.host = new IpcHostAdapter(payload.projectRoot, payload.mode)
  state.provider = createProvider(state.settings)
  send({ id: msg.id, type: 'ready', payload: {} })
  console.error(`[Core] 초기화 완료: ${payload.projectRoot}, provider: ${state.settings.provider.provider}`)
})

registerHandler('user_message', async (msg) => {
  console.error('[Core Trace] 1. Received user_message:', msg.payload)
  // 초기화 체크
  if (!state.host || !state.provider) {
    console.error('[Core Trace] Core 미초기화 에러')
    send({ id: msg.id, type: 'error', payload: { message: 'Core가 아직 초기화되지 않았습니다.', retryable: true } })
    return
  }
  // 중복 실행 방지
  if (state.busy) {
    console.error('[Core Trace] Busy 상태 에러')
    send({ id: msg.id, type: 'error', payload: { message: '이전 요청을 처리 중입니다.', retryable: true } })
    return
  }

  const { text, sessionId } = msg.payload as { text: string; sessionId?: string }

  // 세션 관리
  if (!state.sessionId) {
    state.sessionId = sessionId ?? sessionDb.createSession()
  }
  sessionDb.addMessage(state.sessionId, 'user', text)

  state.busy = true
  console.error('[Core Trace] 2. Set busy flag, starting runLoop')
  try {
    await runLoop({
      userText: text,
      host: state.host,
      provider: state.provider,
      history: [...state.history],
      settings: state.settings,
    })
    sessionDb.autoTitle(state.sessionId)
    console.error('[Core Trace] 3. runLoop completed successfully')
  } catch (err: any) {
    console.error('[Core Trace] X. Error from main runLoop catch block:', err)
  } finally {
    console.error('[Core Trace] 4. Releasing busy flag and sending stream_end')
    state.busy = false
    // stream_end 최종 보장 — runLoop 내부에서 이미 보냈어도 UI의 isBusy를 확실히 풀음
    state.host?.emit('stream_end', {})
  }
})

registerHandler('abort', () => {
  abortLoop()
  state.busy = false
  state.host?.emit('stream_end', {})
  console.error('[Core] 사용자 중단')
})

registerHandler('mode_change', (msg) => {
  const { mode } = msg.payload as { mode: 'plan' | 'ask' | 'auto' }
  state.host?.setMode(mode)
  console.error(`[Core] Mode 변경: ${mode}`)
})

// ── 세션 관리 ────────────────────────────────────────────────

registerHandler('session_select', async (msg) => {
  const { sessionId } = msg.payload as { sessionId: string }
  state.sessionId = sessionId
  const messages = sessionDb.getSessionMessages(sessionId)
  state.history = messages.map(m => ({ role: m.role as any, content: m.content }))
  send({ id: msg.id, type: 'session_history', payload: { sessionId, messages } })
})

registerHandler('session_list', async (msg) => {
  const sessions = sessionDb.listSessions()
  send({ id: msg.id, type: 'sessions_list', payload: { sessions } })
})

registerHandler('session_delete', async (msg) => {
  const { sessionId } = msg.payload as { sessionId: string }
  sessionDb.deleteSession(sessionId)
  if (state.sessionId === sessionId) {
    state.sessionId = null
    state.history = []
  }
})

registerHandler('session_rename', async (msg) => {
  const { sessionId, title } = msg.payload as { sessionId: string; title: string }
  sessionDb.renameSession(sessionId, title)
})

// ── 설정 ─────────────────────────────────────────────────────

registerHandler('settings_get', (msg) => {
  const { settings, isFirstTime } = SettingsManager.load()
  state.settings = settings
  if (state.host) {
    state.provider = createProvider(state.settings)
  }
  console.error(`[Core DEBUG] settings_get sending settings: ${JSON.stringify(settings)}`)
  send({ id: msg.id, type: 'settings_loaded', payload: { settings, isFirstTime } })
  console.error(`[Core] 설정 로드 (provider: ${state.settings.provider.provider}, isFirstTime: ${isFirstTime})`)
})

registerHandler('settings_update', (msg) => {
  state.settings = msg.payload as CaptainSettings
  if (state.host) {
    state.provider = createProvider(state.settings)
  }
  SettingsManager.save(state.settings)
  send({ id: msg.id, type: 'settings_loaded', payload: { settings: state.settings, isFirstTime: false } })
  console.error(`[Core] 설정 업데이트 및 저장완료 (provider: ${state.settings.provider.provider})`)
})

// ── 연결 테스트 / 모델 관리 ──────────────────────────────────

registerHandler('connection_test', async (msg) => {
  const { baseUrl, apiKey } = msg.payload as { baseUrl: string; apiKey?: string }
  try {
    const models = await fetchOllamaModels(baseUrl, apiKey)
    const modelInfos = await Promise.all(
      models.map(async (id) => {
        try {
          const info = await fetchOllamaModelInfo(baseUrl, id, apiKey)
          return { id, name: id, contextWindow: info.contextWindow }
        } catch {
          return { id, name: id }
        }
      })
    )
    send({ id: msg.id, type: 'connection_test_result', payload: { success: true, models: modelInfos } })
    console.error(`[Core] 연결 테스트 성공: ${baseUrl}, ${models.length}개 모델`)
  } catch (e: any) {
    send({ id: msg.id, type: 'connection_test_result', payload: { success: false, error: e.message } })
    console.error(`[Core] 연결 테스트 실패: ${e.message}`)
  }
})

registerHandler('model_list', async (msg) => {
  try {
    const { ollamaBaseUrl, ollamaApiKey, ollamaModel } = state.settings.provider
    const models = await fetchOllamaModels(ollamaBaseUrl, ollamaApiKey || undefined)
    const modelInfos = await Promise.all(
      models.map(async (id) => {
        try {
          const info = await fetchOllamaModelInfo(ollamaBaseUrl, id, ollamaApiKey || undefined)
          return { id, name: id, contextWindow: info.contextWindow }
        } catch {
          return { id, name: id }
        }
      })
    )
    send({ id: msg.id, type: 'model_list_result', payload: { models: modelInfos, currentModel: ollamaModel } })
  } catch (e: any) {
    send({ id: msg.id, type: 'error', payload: { message: `모델 목록 조회 실패: ${e.message}`, retryable: true } })
  }
})

registerHandler('model_switch', async (msg) => {
  const { modelId } = msg.payload as { modelId: string }
  state.settings.provider.ollamaModel = modelId

registerHandler('client_log', async (msg) => {
  const payload = msg.payload as { level: string, message: string }
  console.error(`[Webview] ${payload.message}`)
})
  try {
    const info = await fetchOllamaModelInfo(
      state.settings.provider.ollamaBaseUrl, modelId, state.settings.provider.ollamaApiKey || undefined
    )
    state.settings.model.contextWindow = info.contextWindow
    state.provider = createProvider(state.settings)
    send({ id: msg.id, type: 'model_switched', payload: { modelId, contextWindow: info.contextWindow } })
  } catch (e: any) {
    send({ id: msg.id, type: 'error', payload: { message: `모델 전환 실패: ${e.message}`, retryable: false } })
  }
})

// ── 코드 액션 ────────────────────────────────────────────────

registerHandler('code_action', async (msg) => {
  if (!state.provider || !state.host) return
  const payload = msg.payload as import('./ipc/protocol.js').CodeActionPayload
  try {
    await executeCodeAction(payload, state.provider, state.host)
  } catch (e: any) {
    state.host.emit('error', { message: `코드 액션 실패: ${e.message}`, retryable: false })
  }
})
