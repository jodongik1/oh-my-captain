import { registerHandler, send } from '../server.js'
import { runLoop, abortLoop } from '../../agent/loop.js'
import * as sessionDb from '../../db/session.js'
import { makeLogger } from '../../utils/logger.js'
import type { CoreState } from './state.js'

const log = makeLogger('chat.ts')

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
      const result = await runLoop({
        userText: text,
        host: state.host,
        provider: state.provider,
        history: [...state.history],
        settings: state.settings,
      })

      // ── 히스토리 전체 동기화 (tool_calls, tool 결과 포함) ──
      // 주의: userText는 runLoop 내부에서 messages에 push되므로,
      // 반환된 conversationTurns는 이번 턴의 전체 대화 흐름을 포함합니다.
      state.history = [...state.history, ...result.conversationTurns]

      if (state.sessionId) {
        // 기존 단순 텍스트 추가 방식 대신, 이번 턴에 추가된 모든 메시지를 DB에 기록
        // (단, 기존 DB 스키마가 'user' | 'assistant' 만 지원할 수 있으므로
        // tool 관련 메시지도 적절히 저장되도록 처리해야 하지만, 현재 DB 구현 범위 내에서 처리)
        // 일단 최종 assistant 응답만 UI 세션용으로 저장 (UI는 tool_calls를 상세히 보여주지 않음)
        // 향후 sessionDb도 전체 메시지(tool 포함)를 저장하도록 확장 필요.
        sessionDb.addMessage(state.sessionId, 'assistant', result.finalContent || '(도구 실행 완료)')
      }

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
