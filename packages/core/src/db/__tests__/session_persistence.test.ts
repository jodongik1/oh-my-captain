import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import {
  __setDbForTest,
  createSession,
  addMessage,
  getSessionMessages,
} from '../session.js'

describe('session_db payload round-trip', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    __setDbForTest(db)
  })

  afterEach(() => {
    __setDbForTest(null)
    db.close()
  })

  it('thinking · toolCalls · attachments 가 JSON 으로 round-trip 된다', () => {
    const sid = createSession()

    addMessage(sid, 'user', '안녕', {
      attachments: [{ kind: 'image', mediaType: 'image/png', data: 'AAA' }],
    })
    addMessage(sid, 'assistant', '응답 본문', {
      thinking: '사용자가 무엇을 원하는지 추론',
      thinkingDurationMs: 1234,
      toolCalls: [{ id: 'call_1', name: 'read_file', args: { path: 'a.ts' } }],
    })
    addMessage(sid, 'tool', '"파일 내용"', {
      toolCallId: 'call_1',
      toolName: 'read_file',
    })

    const out = getSessionMessages(sid)
    expect(out).toHaveLength(3)

    expect(out[0].role).toBe('user')
    expect(out[0].attachments).toEqual([
      { kind: 'image', mediaType: 'image/png', data: 'AAA' },
    ])

    expect(out[1].role).toBe('assistant')
    expect(out[1].content).toBe('응답 본문')
    expect(out[1].thinking).toBe('사용자가 무엇을 원하는지 추론')
    expect(out[1].thinkingDurationMs).toBe(1234)
    expect(out[1].toolCalls).toEqual([
      { id: 'call_1', name: 'read_file', args: { path: 'a.ts' } },
    ])

    expect(out[2].role).toBe('tool')
    expect(out[2].toolCallId).toBe('call_1')
    expect(out[2].toolName).toBe('read_file')
    expect(out[2].content).toBe('"파일 내용"')
  })

  it('payload 가 NULL 인 레거시 행은 평문으로 그대로 반환된다', () => {
    const sid = createSession()
    addMessage(sid, 'user', '레거시 입력')
    addMessage(sid, 'assistant', '레거시 응답')

    const out = getSessionMessages(sid)
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ role: 'user', content: '레거시 입력' })
    expect(out[0].thinking).toBeUndefined()
    expect(out[0].toolCalls).toBeUndefined()
    expect(out[0].attachments).toBeUndefined()
    expect(out[1]).toMatchObject({ role: 'assistant', content: '레거시 응답' })
  })

  it('toolCalls 만 있고 본문이 빈 어시스턴트 turn 도 정확히 복원된다', () => {
    const sid = createSession()
    addMessage(sid, 'assistant', '', {
      toolCalls: [
        { id: 'c1', name: 'list_dir', args: { path: '.' } },
        { id: 'c2', name: 'read_file', args: { path: 'README.md' } },
      ],
    })

    const out = getSessionMessages(sid)
    expect(out[0].content).toBe('')
    expect(out[0].toolCalls).toHaveLength(2)
    expect(out[0].toolCalls?.[0].id).toBe('c1')
    expect(out[0].toolCalls?.[1].name).toBe('read_file')
  })

  it('payload 미지정 시 NULL 로 저장되고 추가 필드도 응답에 없다', () => {
    const sid = createSession()
    addMessage(sid, 'assistant', '단순 응답')
    const row = (db.prepare('SELECT payload FROM messages').get() as { payload: string | null })
    expect(row.payload).toBeNull()

    const out = getSessionMessages(sid)
    expect(out[0].thinking).toBeUndefined()
  })
})
