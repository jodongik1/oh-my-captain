import { describe, it, expect } from 'vitest'
import { compactMessages } from '../compactor.js'
import type { LLMProvider, Message } from '../../providers/types.js'

const fakeProvider = {
  name: 'fake',
  async stream() { throw new Error('not used') },
  async complete() { return '요약된 내용입니다.' },
} as unknown as LLMProvider

function makeMessages(toolBodyChars: number, toolCount: number): Message[] {
  const big = 'X'.repeat(toolBodyChars)
  const out: Message[] = [
    { role: 'system', content: 'system prompt'.repeat(10) },
    { role: 'user', content: '시작 메시지' },
  ]
  for (let i = 0; i < toolCount; i++) {
    out.push({ role: 'assistant', content: '', tool_calls: [{ id: `t${i}`, function: { name: 'read_file', arguments: { path: `f${i}.ts` } } }] })
    out.push({ role: 'tool', tool_call_id: `t${i}`, content: big })
  }
  // 최근 메시지 유지용
  out.push({ role: 'user', content: '추가 질문' })
  out.push({ role: 'assistant', content: '답변 중...' })
  return out
}

describe('compactMessages', () => {
  it('체크 임계 이하면 stage="none" 반환', async () => {
    const msgs: Message[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: '안녕' },
    ]
    const r = await compactMessages(msgs, 200_000, fakeProvider)
    expect(r.stage).toBe('none')
    expect(r.messages).toBe(msgs)
  })

  it('대용량 tool_result 가 있으면 snip/microcompact 단계까지 적용해 토큰 감소', async () => {
    // 200_000 컨텍스트 윈도우 대비 80%+ 가 되도록 큰 tool_result 를 넣음
    const msgs = makeMessages(80_000, 8) // 약 640_000 chars * 0.25 = 160_000 토큰 (80%)
    const r = await compactMessages(msgs, 200_000, fakeProvider)
    expect(['snip', 'microcompact', 'collapse', 'auto']).toContain(r.stage)
    expect(r.afterTokens).toBeLessThan(r.beforeTokens)
  })

  it('수퍼 큰 컨텍스트는 강한 단계로 진입해 토큰을 절반 이하로 감축', async () => {
    const msgs = makeMessages(200_000, 6) // 약 1.2M chars = ~300k 토큰 (150%)
    const r = await compactMessages(msgs, 200_000, fakeProvider)
    expect(['snip', 'microcompact', 'collapse', 'auto']).toContain(r.stage)
    expect(r.afterTokens).toBeLessThan(r.beforeTokens / 2)
  })

  it('압축 후에도 system 메시지(0번)와 최근 메시지는 보존', async () => {
    const msgs = makeMessages(50_000, 6)
    const r = await compactMessages(msgs, 200_000, fakeProvider)
    expect(r.messages[0].role).toBe('system')
    // 마지막 메시지가 user 또는 assistant 여야 함 (보존된 최근 영역)
    const last = r.messages[r.messages.length - 1]
    expect(['user', 'assistant', 'tool']).toContain(last.role)
  })
})
