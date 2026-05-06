import { registerHandler } from '../server.js'
import { replyError } from '../reply.js'
import { runLoop } from '../../agent/loop.js'
import * as sessionDb from '../../db/session.js'
import { makeLogger } from '../../utils/logger.js'
import type { CoreState } from './state.js'

const log = makeLogger('chat.ts')

export function registerChatHandlers(state: CoreState) {
  // [흐름 5] IPC 서버로부터 'user_message' 메시지 라우팅 진입점
  registerHandler('user_message', async (msg, reply) => {
    log.debug('1. Received user_message:', msg.payload)
    if (!state.host || !state.provider) {
      log.error('Core 미초기화 에러')
      replyError(reply, msg.id, 'Core가 아직 초기화되지 않았습니다.', true)
      return
    }

    // 진행 중인 loop 가 있으면 abort 신호 발사 + 종료까지 대기.
    // (abort 후 retry / 빠른 연속 입력 시 race 방지)
    if (state.run.busy && state.run.currentRun) {
      log.info('이전 runLoop 가 진행 중 — abort 후 종료까지 대기')
      await state.run.abortAndWait()
    }

    const { text, sessionId, attachments } = msg.payload

    if (!state.sessionId) {
      state.sessionId = sessionId ?? sessionDb.createSession()
    }
    // 사용자 첨부도 함께 영속화 — 히스토리에서 다시 열 때 이미지 카드 복원에 사용.
    sessionDb.addMessage(
      state.sessionId,
      'user',
      text,
      attachments && attachments.length > 0 ? { attachments } : undefined,
    )

    log.debug('2. Set busy flag, starting runLoop')
    await state.run.beginRun(async () => {
      try {
        // [흐름 6] Agent Loop 실행 → LLM 스트리밍 + 도구 실행 사이클
        const result = await runLoop({
          userText: text,
          host: state.host!,
          provider: state.provider!,
          history: [...state.history],
          settings: state.settings,
          controller: state.run.loopController,
          attachments: attachments?.map(a => ({ mediaType: a.mediaType, data: a.data })),
        })

        state.history = [...state.history, ...result.conversationTurns]

        if (state.sessionId) {
          // 이번 턴의 어시스턴트/도구 시퀀스를 그대로 영속화 — 라이브 타임라인 복원의 1차 근거.
          for (const entry of result.persistedTurn) {
            sessionDb.addMessage(state.sessionId, entry.role, entry.content, {
              ...(entry.thinking ? { thinking: entry.thinking } : {}),
              ...(entry.thinkingDurationMs ? { thinkingDurationMs: entry.thinkingDurationMs } : {}),
              ...(entry.toolCalls ? { toolCalls: entry.toolCalls } : {}),
              ...(entry.toolCallId ? { toolCallId: entry.toolCallId } : {}),
              ...(entry.toolName ? { toolName: entry.toolName } : {}),
            })
          }
          // persistedTurn 이 비어 있으면 (예: 모델이 즉시 에러로 빠진 경우) 최소한 finalContent 라도 남긴다.
          if (result.persistedTurn.length === 0 && result.finalContent) {
            sessionDb.addMessage(state.sessionId, 'assistant', result.finalContent)
          }
          sessionDb.autoTitle(state.sessionId)
        }
        log.debug('3. runLoop completed successfully')
      } catch (err) {
        log.error('runLoop catch block:', err)
        state.host?.emit('error', {
          message: err instanceof Error ? err.message : '대화 처리 중 알 수 없는 오류',
          retryable: true,
        })
      } finally {
        log.debug('4. Releasing busy flag and sending turn_done')
        state.host?.emit('stream_end', {})
        state.host?.emit('turn_done', {})
      }
    })
  })

  registerHandler('abort', () => {
    state.run.loopController.abort()
    // codeActionController 의 cleanup(null 처리)은 code_action.ts 의 finally 가 책임진다.
    // 여기서 null 로 만들면 두 곳에서 set 하는 race 가 생기고, finally 가 우리 것인지 식별하기 어려워진다.
    state.run.codeActionController?.abort()
    log.info('사용자 중단')
  })
}
