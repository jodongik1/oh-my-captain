// 세션 / 모델 / 파일 검색 도메인 핸들러.

import type { IpcHandlerFactory } from '../types'
import type { TimelineEntry, Attachment } from '../../../store'
import type { SessionMessage, ImageAttachment } from '@omc/protocol'

function toUiAttachments(persisted: ImageAttachment[] | undefined): Attachment[] | undefined {
  if (!persisted || persisted.length === 0) return undefined
  return persisted.map(p => ({
    kind: 'image' as const,
    mediaType: p.mediaType,
    data: p.data,
    filename: p.filename,
    // UI 전용 dataUrl 은 mediaType + base64 로 합성. width/height/size 는 영속화하지 않으므로 undefined.
    dataUrl: `data:${p.mediaType};base64,${p.data}`,
  }))
}

/**
 * 영속화된 메시지 시퀀스를 라이브 타임라인과 동등하게 복원.
 *
 * 매핑:
 *  - role=user : user 엔트리 (attachments 복원)
 *  - role=assistant :
 *      thinking 본문이 있으면  thinking 엔트리 (isActive=false)
 *      content 가 있으면         stream 엔트리 (isStreaming=false)
 *      toolCalls 가 있으면      각각 tool_start 엔트리 (isActive=false). 결과는 후속 tool 행에서 병합.
 *  - role=tool : 직전 toolCalls 의 매칭되는 tool_start 에 result 를 채움.
 *
 * 레거시 폴백: payload 가 비어있는 행 (예: 구버전에서 저장된 row) 은
 *  - role=user → user 엔트리 (text)
 *  - role=assistant → stream 엔트리 (text)
 *  - role=tool → 무시 (호출자 정보 부재)
 */
function buildTimelineFromHistory(messages: SessionMessage[]): TimelineEntry[] {
  const out: TimelineEntry[] = []
  // tool_call_id → tool_start 엔트리의 out 인덱스 매핑 — 도구 결과가 도착하면 result 로 병합.
  const pendingToolByCallId = new Map<string, number>()

  for (const m of messages) {
    if (m.role === 'user') {
      out.push({
        id: m.id,
        type: 'user',
        content: m.content,
        timestamp: m.timestamp,
        ...(toUiAttachments(m.attachments) ? { attachments: toUiAttachments(m.attachments)! } : {}),
      })
      continue
    }

    if (m.role === 'assistant') {
      // thinking 블록 — 본문이 있을 때만 노출 (durationMs 가 없으면 표기 생략).
      if (m.thinking && m.thinking.length > 0) {
        out.push({
          id: `${m.id}_think`,
          type: 'thinking',
          content: m.thinking,
          ...(m.thinkingDurationMs ? { durationMs: m.thinkingDurationMs } : {}),
          isActive: false,
          timestamp: m.timestamp,
        })
      }
      // 본문 텍스트
      if (m.content && m.content.length > 0) {
        out.push({
          id: `${m.id}_stream`,
          type: 'stream',
          source: 'chat',
          content: m.content,
          isStreaming: false,
          timestamp: m.timestamp,
        })
      }
      // 도구 호출 — 각각 tool_start 엔트리 생성, tool 결과는 추후 병합.
      if (m.toolCalls && m.toolCalls.length > 0) {
        for (const tc of m.toolCalls) {
          const toolEntry: TimelineEntry = {
            id: `${m.id}_${tc.id}`,
            type: 'tool_start',
            tool: tc.name,
            args: tc.args,
            isActive: false,
            timestamp: m.timestamp,
          }
          out.push(toolEntry)
          pendingToolByCallId.set(tc.id, out.length - 1)
        }
      }
      // 레거시 폴백 — payload 가 전혀 없고 content 도 없으면 빈 stream 한 개라도 표시 (이전 버전의 '(도구 실행 완료)' 같은 placeholder).
      if (
        !m.thinking &&
        !m.toolCalls?.length &&
        (!m.content || m.content.length === 0)
      ) {
        out.push({
          id: `${m.id}_stream`,
          type: 'stream',
          source: 'chat',
          content: '',
          isStreaming: false,
          timestamp: m.timestamp,
        })
      }
      continue
    }

    if (m.role === 'tool') {
      const idx = m.toolCallId ? pendingToolByCallId.get(m.toolCallId) : undefined
      if (idx !== undefined) {
        const target = out[idx]
        if (target.type === 'tool_start') {
          // JSON 으로 저장된 결과는 파싱, 아니면 문자열 그대로 보존.
          let parsed: unknown = m.content
          try { parsed = JSON.parse(m.content) } catch { /* 평문 결과 */ }
          out[idx] = { ...target, result: parsed }
        }
        pendingToolByCallId.delete(m.toolCallId!)
      }
      // 매칭되는 호출자가 없으면 (레거시) 조용히 무시.
      continue
    }
  }

  return out
}

export const createSessionHandlers: IpcHandlerFactory = ({ dispatch }) => ({
  sessions_list: (payload) => {
    dispatch({ type: 'SET_SESSIONS', sessions: payload.sessions })
  },

  session_history: (payload) => {
    const entries = buildTimelineFromHistory(payload.messages)
    for (const entry of entries) {
      dispatch({ type: 'ADD_TIMELINE', entry })
    }
  },

  model_list_result: (payload) => {
    dispatch({ type: 'SET_AVAILABLE_MODELS', models: payload.models })
    dispatch({ type: 'SET_MODEL', modelId: payload.currentModel })
  },

  model_switched: (payload) => {
    dispatch({
      type: 'SET_MODEL',
      modelId: payload.modelId,
      contextWindow: payload.contextWindow,
      capabilities: payload.capabilities,
    })
  },

  file_search_result: (payload) => {
    dispatch({ type: 'SET_FILE_SEARCH_RESULTS', files: payload.files })
  },
})
