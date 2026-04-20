import { registerHandler, send } from '../server.js'
import { runLoop, abortLoop } from '../../agent/loop.js'
import * as sessionDb from '../../db/session.js'
import { makeLogger } from '../../utils/logger.js'
import type { CoreState } from './state.js'

const log = makeLogger('Core')

export function registerChatHandlers(state: CoreState) {
  // [흐름 5] IPC 서버로부터 'user_message' 메시지 라우팅 진입점
  registerHandler('user_message', async (msg) => {
    log.debug('1. Received user_message:', msg.payload)
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
        host: state.host,
        provider: state.provider,
        history: [...state.history],
        settings: state.settings,
      })
      if (assistantContent && state.sessionId) {
        sessionDb.addMessage(state.sessionId, 'assistant', assistantContent)
      }
      state.history = [
        ...state.history,
        { role: 'user', content: text },
        ...(assistantContent ? [{ role: 'assistant' as const, content: assistantContent }] : []),
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
    state.codeActionController?.abort()
    state.codeActionController = null
    // busy 해제와 stream_end는 runLoop finally 블록에서 처리
    // 여기서 busy를 해제하면 runLoop가 아직 실행 중인 상태에서 새 메시지가 들어와 두 루프가 동시 실행됨
    log.info('사용자 중단')
  })
}
