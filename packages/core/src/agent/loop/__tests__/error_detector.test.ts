import { describe, it, expect } from 'vitest'
import { ToolErrorDetector } from '../error_detector.js'
import type { Message } from '../../../providers/types.js'

const toolErr = (id: string, error: string): Message => ({
  role: 'tool',
  tool_call_id: id,
  content: JSON.stringify({ error }),
})

const toolOk = (id: string, payload: unknown = { ok: true }): Message => ({
  role: 'tool',
  tool_call_id: id,
  content: JSON.stringify(payload),
})

describe('ToolErrorDetector', () => {
  it('에러가 없으면 shouldBreak=false', () => {
    const d = new ToolErrorDetector()
    expect(d.observe([toolOk('a')]).shouldBreak).toBe(false)
  })

  it('동일 에러가 3회 연속이면 shouldBreak=true', () => {
    const d = new ToolErrorDetector()
    expect(d.observe([toolErr('a', 'ENOENT')]).shouldBreak).toBe(false)
    expect(d.observe([toolErr('b', 'ENOENT')]).shouldBreak).toBe(false)
    const obs = d.observe([toolErr('c', 'ENOENT')])
    expect(obs.shouldBreak).toBe(true)
    expect(obs.userMessage).toMatch(/3회/)
  })

  it('에러 시그니처가 달라지면 카운터가 리셋된다', () => {
    const d = new ToolErrorDetector()
    d.observe([toolErr('a', 'ENOENT')])
    d.observe([toolErr('b', 'ENOENT')])
    // 다른 에러 등장 → 리셋
    expect(d.observe([toolErr('c', 'PERM')]).shouldBreak).toBe(false)
    expect(d.observe([toolErr('d', 'PERM')]).shouldBreak).toBe(false)
    expect(d.observe([toolErr('e', 'PERM')]).shouldBreak).toBe(true)
  })

  it('성공 결과가 사이에 끼면 카운터가 리셋된다', () => {
    const d = new ToolErrorDetector()
    d.observe([toolErr('a', 'ENOENT')])
    d.observe([toolErr('b', 'ENOENT')])
    d.observe([toolOk('c')])  // 리셋
    expect(d.observe([toolErr('d', 'ENOENT')]).shouldBreak).toBe(false)
  })

  it('JSON parse 실패 메시지는 무시한다', () => {
    const d = new ToolErrorDetector()
    const broken: Message = { role: 'tool', tool_call_id: 'x', content: 'not-json' }
    expect(d.observe([broken]).shouldBreak).toBe(false)
  })
})
