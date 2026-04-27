import { registerHandler, send } from '../server.js'
import { runLoop, abortLoop } from '../../agent/loop.js'
import * as sessionDb from '../../db/session.js'
import { makeLogger } from '../../utils/logger.js'
import type { CoreState } from './state.js'

const log = makeLogger('chat.ts')

/**
 * 진행 중 runLoop 의 promise.
 * abort 후 retry 처럼 빠른 연속 user_message 가 들어오면 이전 loop 가 완전히 종료될 때까지
 * await 하여 두 loop 가 동시 실행되거나 race 가 나지 않도록 한다.
 */
let currentRun: Promise<void> | null = null

export function registerChatHandlers(state: CoreState) {
  // [흐름 5] IPC 서버로부터 'user_message' 메시지 라우팅 진입점
  registerHandler('user_message', async (msg) => {
    log.debug('1. Received user_message:', msg.payload)
    if (!state.host || !state.provider) {
      log.error('Core 미초기화 에러')
      send({ id: msg.id, type: 'error', payload: { message: 'Core가 아직 초기화되지 않았습니다.', retryable: true } })
      return
    }

    // 진행 중인 loop 가 있으면 먼저 abort 신호 발사 + 종료까지 대기.
    // (abort 후 retry / 빠른 연속 입력 시 race 방지)
    if (state.busy && currentRun) {
      log.info('이전 runLoop 가 진행 중 — abort 후 종료까지 대기')
      abortLoop()
      try { await currentRun } catch { /* 이전 loop 의 catch 는 자체에서 처리 */ }
    }

    const { text, sessionId, attachments } = msg.payload as {
      text: string
      sessionId?: string
      attachments?: { kind: 'image'; mediaType: string; data: string; filename?: string }[]
    }

    // 세션이 없으면 신규 생성, 있으면 기존 세션에 이어붙임
    if (!state.sessionId) {
      state.sessionId = sessionId ?? sessionDb.createSession()
    }
    sessionDb.addMessage(state.sessionId, 'user', text)

    state.busy = true
    log.debug('2. Set busy flag, starting runLoop')

    currentRun = (async () => {
      try {
        // [흐름 6] Agent Loop 실행 → LLM 스트리밍 + 도구 실행 사이클
        const result = await runLoop({
          userText: text,
          host: state.host!,
          provider: state.provider!,
          history: [...state.history],
          settings: state.settings,
          attachments: attachments?.map(a => ({ mediaType: a.mediaType, data: a.data })),
        })

        state.history = [...state.history, ...result.conversationTurns]

        if (state.sessionId) {
          sessionDb.addMessage(state.sessionId, 'assistant', result.finalContent || '(도구 실행 완료)')
        }

        sessionDb.autoTitle(state.sessionId!)
        log.debug('3. runLoop completed successfully')
      } catch (err: any) {
        log.error('runLoop catch block:', err)
      } finally {
        log.debug('4. Releasing busy flag and sending turn_done')
        state.busy = false
        state.host?.emit('stream_end', {})
        state.host?.emit('turn_done', {})
        currentRun = null
      }
    })()

    await currentRun
  })

  registerHandler('abort', () => {
    abortLoop()
    // codeActionController 의 cleanup(null 처리)은 code_action.ts 의 finally 가 책임진다.
    // 여기서 null 로 만들면 두 곳에서 set 하는 race 가 생기고, finally 가 우리 것인지 식별하기 어려워진다.
    state.codeActionController?.abort()
    // busy 해제와 stream_end는 runLoop finally 블록에서 처리.
    // race 는 user_message 핸들러가 currentRun await 으로 막음.
    log.info('사용자 중단')
  })
}
