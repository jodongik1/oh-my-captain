import { startServer, registerHandler, send } from './ipc/server.js'
import { IpcHostAdapter } from './host/ipc_adapter.js'
import { OllamaProvider, fetchOllamaModels, fetchOllamaModelInfo } from './providers/ollama.js'
import { OpenAIProvider } from './providers/openai.js'
import { AnthropicProvider } from './providers/anthropic.js'
import { runLoop, abortLoop, injectSteering } from './agent/loop.js'
import { executeCodeAction } from './actions/handler.js'
import { DEFAULT_SETTINGS } from './settings/types.js'
import { SettingsManager } from './settings/manager.js'
import * as sessionDb from './db/session.js'
import type { LLMProvider, Message } from './providers/types.js'
import type { InitPayload, CaptainSettings } from './ipc/protocol.js'
import { makeLogger } from './utils/logger.js'

const log = makeLogger('Core')

// 프로세스 크래시 방지
process.on('unhandledRejection', (reason) => {
  log.error('Unhandled rejection:', reason)
})
process.on('uncaughtException', (err) => {
  log.error('Uncaught exception:', err)
})

// ── 단일 상태 객체 ──────────────────────────────────────────
interface CoreState {
  host: IpcHostAdapter | null
  provider: LLMProvider | null
  settings: CaptainSettings
  sessionId: string | null
  history: Message[]
  busy: boolean
  codeActionController: AbortController | null
}

const state: CoreState = {
  host: null,
  provider: null,
  settings: DEFAULT_SETTINGS as unknown as CaptainSettings,
  sessionId: null,
  history: [],
  busy: false,
  codeActionController: null,
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
import './tools/memory_tool.js'

// ── IPC 서버 시작 ────────────────────────────────────────────
startServer(() => {
  log.info('IPC 서버 대기 중...')
})

// ── 핸들러 등록 ──────────────────────────────────────────────

registerHandler('init', (msg) => {
  const payload = msg.payload as InitPayload
  state.host = new IpcHostAdapter(payload.projectRoot, payload.mode)
  state.provider = createProvider(state.settings)
  send({ id: msg.id, type: 'ready', payload: {} })
  log.info(`초기화 완료: ${payload.projectRoot}, provider: ${state.settings.provider.provider}`)
})

// [흐름 5] IPC 서버로부터 'user_message' 메시지 라우팅 진입점
registerHandler('user_message', async (msg) => {
  log.debug('1. Received user_message:', msg.payload)
  // 초기화 체크
  if (!state.host || !state.provider) {
    log.error('Core 미초기화 에러')
    send({ id: msg.id, type: 'error', payload: { message: 'Core가 아직 초기화되지 않았습니다.', retryable: true } })
    return
  }
  // 중복 실행 방지 (이전 runLoop가 아직 실행 중인 경우)
  if (state.busy) {
    log.warn('Busy 상태 - 이전 요청 처리 중')
    send({ id: msg.id, type: 'error', payload: { message: '이전 요청을 처리 중입니다.', retryable: true } })
    return
  }

  const { text, sessionId } = msg.payload as { text: string; sessionId?: string }

  // 세션이 없으면 신규 생성, 있으면 기존 세션에 이어붙임
  if (!state.sessionId) {
    state.sessionId = sessionId ?? sessionDb.createSession()
  }
  sessionDb.addMessage(state.sessionId, 'user', text)

  state.busy = true
  log.debug('2. Set busy flag, starting runLoop')
  try {
    // [흐름 6] Agent Loop 실행 → LLM 스트리밍 + 도구 실행 사이클
    const assistantContent = await runLoop({
      userText: text,
      host: state.host,       // IpcHostAdapter: 이벤트를 stdout으로 전송
      provider: state.provider, // OllamaProvider 등: LLM HTTP 스트리밍
      history: [...state.history],
      settings: state.settings,
    })
    if (assistantContent && state.sessionId) {
      sessionDb.addMessage(state.sessionId, 'assistant', assistantContent)
    }
    // 히스토리 누적 (다음 turn에 컨텍스트로 전달)
    state.history = [
      ...state.history,
      { role: 'user', content: text },
      ...(assistantContent ? [{ role: 'assistant' as const, content: assistantContent }] : [])
    ]
    sessionDb.autoTitle(state.sessionId)
    log.debug('3. runLoop completed successfully')
  } catch (err: any) {
    log.error('runLoop catch block:', err)
  } finally {
    log.debug('4. Releasing busy flag and sending stream_end')
    state.busy = false
    // stream_end 최종 보장 — runLoop 내부에서 이미 보냈어도 UI의 isBusy를 확실히 풀음
    state.host?.emit('stream_end', {})
  }
})

registerHandler('abort', () => {
  abortLoop()
  // 코드 액션도 함께 중단
  state.codeActionController?.abort()
  state.codeActionController = null
  // busy 해제와 stream_end는 runLoop finally 블록에서 처리
  // 여기서 busy를 해제하면 runLoop가 아직 실행 중인 상태에서 새 메시지가 들어와 두 루프가 동시 실행됨
  log.info('사용자 중단')
})

registerHandler('mode_change', (msg) => {
  const { mode } = msg.payload as { mode: 'plan' | 'ask' | 'auto' }
  state.host?.setMode(mode)
  log.info(`Mode 변경: ${mode}`)
})

// ── 스티어링 큐 ──────────────────────────────────────────────

registerHandler('steer_inject', (msg) => {
  const { text } = msg.payload as { text: string }
  if (state.busy) {
    injectSteering(text)
    log.debug(`스티어링 주입: ${text.slice(0, 80)}...`)
  } else {
    log.warn('스티어링 무시 (루프 미실행 중)')
  }
})

registerHandler('steer_interrupt', () => {
  abortLoop()
  log.info('스티어링 인터럽트')
})

// ── 세션 관리 ────────────────────────────────────────────────

registerHandler('session_select', async (msg) => {
  const { sessionId } = msg.payload as { sessionId: string }
  state.sessionId = sessionId
  const messages = sessionDb.getSessionMessages(sessionId)
  state.history = messages.map(m => ({ role: m.role as any, content: m.content }))
  send({ id: msg.id, type: 'session_history', payload: { sessionId, messages } })
})

registerHandler('session_new', (msg) => {
  state.sessionId = null
  state.history = []
  send({ id: msg.id, type: 'ready', payload: {} })
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
  log.debug(`settings_get sending settings: ${JSON.stringify(settings)}`)
  send({ id: msg.id, type: 'settings_loaded', payload: { settings, isFirstTime } })
  log.info(`설정 로드 (provider: ${state.settings.provider.provider}, isFirstTime: ${isFirstTime})`)
})

registerHandler('settings_update', (msg) => {
  const incoming = msg.payload as CaptainSettings
  state.settings = { ...incoming, cachedModels: state.settings.cachedModels }
  if (state.host) {
    state.provider = createProvider(state.settings)
  }
  SettingsManager.save(state.settings)
  send({ id: msg.id, type: 'settings_loaded', payload: { settings: state.settings, isFirstTime: false } })
  log.info(`설정 업데이트 및 저장완료 (provider: ${state.settings.provider.provider})`)
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
    state.settings.cachedModels = modelInfos
    SettingsManager.save(state.settings)
    send({ id: msg.id, type: 'connection_test_result', payload: { success: true, models: modelInfos } })
    log.info(`연결 테스트 성공: ${baseUrl}, ${models.length}개 모델`)
  } catch (e: any) {
    send({ id: msg.id, type: 'connection_test_result', payload: { success: false, error: e.message } })
    log.error(`연결 테스트 실패: ${e.message}`)
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
  try {
    const info = await fetchOllamaModelInfo(
      state.settings.provider.ollamaBaseUrl, modelId, state.settings.provider.ollamaApiKey || undefined
    )
    state.settings.model.contextWindow = info.contextWindow
    state.provider = createProvider(state.settings)
    SettingsManager.save(state.settings)
    send({ id: msg.id, type: 'model_switched', payload: { modelId, contextWindow: info.contextWindow } })
  } catch (e: any) {
    send({ id: msg.id, type: 'error', payload: { message: `모델 전환 실패: ${e.message}`, retryable: false } })
  }
})

// ── 클라이언트 로그 ──────────────────────────────────────────

registerHandler('client_log', async (msg) => {
  const payload = msg.payload as { level: string; message: string }
  const prefix =
    payload.level === 'error' ? '[Webview:ERROR]' :
    payload.level === 'warn'  ? '[Webview:WARN]'  :
    payload.level === 'debug' ? '[Webview:DEBUG]' :
                                '[Webview:INFO]'
  console.error(`${prefix} ${payload.message}`)
})

// ── 코드 액션 ────────────────────────────────────────────────

registerHandler('code_action', async (msg) => {
  if (!state.provider || !state.host) return
  const payload = msg.payload as import('./ipc/protocol.js').CodeActionPayload
  const controller = new AbortController()
  state.codeActionController = controller
  try {
    await executeCodeAction(payload, state.provider, state.host, controller.signal)
  } catch (e: any) {
    if (!controller.signal.aborted) {
      state.host.emit('error', { message: `코드 액션 실패: ${e.message}`, retryable: false })
    }
  } finally {
    state.codeActionController = null
  }
})
