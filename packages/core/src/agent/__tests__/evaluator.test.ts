import { describe, it, expect, vi } from 'vitest'
import { Evaluator, callsIncludeWrite } from '../evaluator.js'
import type { LLMProvider, Message } from '../../providers/types.js'

function makeProvider(verdictResponse: string): LLMProvider {
  return {
    name: 'fake',
    async stream() { throw new Error('not used') },
    async complete() { return verdictResponse },
  } as unknown as LLMProvider
}

const recent: Message[] = [
  { role: 'user', content: '버그 X 고쳐줘' },
  { role: 'assistant', content: '', tool_calls: [{ id: '1', function: { name: 'read_file', arguments: { path: 'a.ts' } } }] },
  { role: 'tool', tool_call_id: '1', content: '{}' },
]

describe('Evaluator.shouldEvaluate', () => {
  it('write 도구 직후 평가 트리거', () => {
    const e = new Evaluator()
    expect(e.shouldEvaluate({ iteration: 1, usedWriteTool: true, consecutiveSameTool: false })).toBe(true)
  })
  it('동일 도구 연속 호출 시 트리거', () => {
    const e = new Evaluator()
    expect(e.shouldEvaluate({ iteration: 5, usedWriteTool: false, consecutiveSameTool: true })).toBe(true)
  })
  it('cadence 미달은 트리거 X', () => {
    const e = new Evaluator()
    expect(e.shouldEvaluate({ iteration: 1, usedWriteTool: false, consecutiveSameTool: false })).toBe(false)
  })
})

describe('Evaluator.evaluate', () => {
  it('on_track JSON 응답을 정확히 파싱', async () => {
    const e = new Evaluator()
    const provider = makeProvider('{"verdict":"on_track","rationale":"진행 중","suggestion":""}')
    const r = await e.evaluate({ userGoal: 'X', recent, iteration: 1, provider })
    expect(r.verdict).toBe('on_track')
  })

  it('drift verdict 파싱 + driftCount 누적', async () => {
    const e = new Evaluator()
    const provider = makeProvider('{"verdict":"drift","rationale":"이탈","suggestion":"본 목표로 복귀"}')
    await e.evaluate({ userGoal: 'X', recent, iteration: 1, provider })
    await e.evaluate({ userGoal: 'X', recent, iteration: 2, provider })
    expect(e.shouldForceFinalize()).toBe(true) // driftThreshold=2
  })

  it('파싱 불가능한 응답은 on_track 으로 폴백', async () => {
    const e = new Evaluator()
    const provider = makeProvider('이건 JSON 아님')
    const r = await e.evaluate({ userGoal: 'X', recent, iteration: 1, provider })
    expect(r.verdict).toBe('on_track')
  })

  it('provider 호출 실패 시 on_track 으로 폴백', async () => {
    const e = new Evaluator()
    const provider = {
      name: 'broken',
      async stream() { throw new Error('not used') },
      async complete() { throw new Error('boom') },
    } as unknown as LLMProvider
    const r = await e.evaluate({ userGoal: 'X', recent, iteration: 1, provider })
    expect(r.verdict).toBe('on_track')
  })
})

describe('Evaluator.toHint', () => {
  it('on_track 은 null 반환', () => {
    const e = new Evaluator()
    expect(e.toHint({ verdict: 'on_track', rationale: 'ok' }, false)).toBeNull()
  })
  it('drift 는 system hint 메시지 반환', () => {
    const e = new Evaluator()
    const m = e.toHint({ verdict: 'drift', rationale: '이탈', suggestion: '복귀' }, false)
    expect(m?.role).toBe('system')
    expect(m?.content).toMatch(/Evaluator/)
  })
  it('forceFinalize=true 는 마무리 답변 강제', () => {
    const e = new Evaluator()
    const m = e.toHint({ verdict: 'drift', rationale: '이탈' }, true)
    expect(m?.content).toMatch(/도구를 호출하지 말고/)
  })
})

describe('callsIncludeWrite', () => {
  it('write 도구 포함 감지', () => {
    expect(callsIncludeWrite([{ id: '1', function: { name: 'edit_file', arguments: {} } }])).toBe(true)
    expect(callsIncludeWrite([{ id: '1', function: { name: 'read_file', arguments: {} } }])).toBe(false)
    expect(callsIncludeWrite(undefined)).toBe(false)
  })
})
