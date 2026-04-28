import { describe, it, expect, beforeAll } from 'vitest'
import { validateSingleToolCall, formatValidationFailure } from '../validator.js'
import { registerTool } from '../../tools/registry.js'

beforeAll(() => {
  // 테스트용 도구 등록
  registerTool(
    {
      type: 'function',
      function: {
        name: 'test_tool',
        description: 'test',
        parameters: {
          type: 'object',
          required: ['path', 'mode'],
          properties: {
            path: { type: 'string' },
            mode: { type: 'string', enum: ['read', 'write'] },
            count: { type: 'integer' },
          },
        },
      },
      category: 'readonly',
      concurrencySafe: true,
    },
    async () => ({ ok: true })
  )
})

describe('validateSingleToolCall', () => {
  it('정의되지 않은 도구는 즉시 실패', () => {
    const r = validateSingleToolCall({ id: '1', function: { name: 'no_such', arguments: {} } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/정의되지 않은 도구/)
  })

  it('required 누락 감지', () => {
    const r = validateSingleToolCall({
      id: '1',
      function: { name: 'test_tool', arguments: { path: 'x.ts' } },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/필수 인자/)
  })

  it('타입 불일치 감지', () => {
    const r = validateSingleToolCall({
      id: '1',
      function: { name: 'test_tool', arguments: { path: 'x.ts', mode: 'read', count: 'not-a-number' } },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/타입이 잘못됨/)
  })

  it('enum 불일치 감지', () => {
    const r = validateSingleToolCall({
      id: '1',
      function: { name: 'test_tool', arguments: { path: 'x.ts', mode: 'invalid' } },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/enum/)
  })

  it('절대경로 차단', () => {
    const r = validateSingleToolCall({
      id: '1',
      function: { name: 'test_tool', arguments: { path: '/etc/passwd', mode: 'read' } },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/절대경로/)
  })

  it("'..' 포함 경로 차단", () => {
    const r = validateSingleToolCall({
      id: '1',
      function: { name: 'test_tool', arguments: { path: '../../secrets.txt', mode: 'read' } },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/\.\./)
  })

  it("'@' 멘션 prefix 가 path 에 포함되면 차단", () => {
    const r = validateSingleToolCall({
      id: '1',
      function: { name: 'test_tool', arguments: { path: '@src/x.ts', mode: 'read' } },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/@/)
  })

  it('정상 호출은 통과', () => {
    const r = validateSingleToolCall({
      id: '1',
      function: { name: 'test_tool', arguments: { path: 'src/x.ts', mode: 'read', count: 3 } },
    })
    expect(r.ok).toBe(true)
  })
})

describe('formatValidationFailure', () => {
  it('__preflight: true 와 error/suggestion 을 포함한 JSON 반환', () => {
    const json = formatValidationFailure({ ok: false, error: 'X 오류', suggestion: 'Y 시도' })
    const parsed = JSON.parse(json)
    expect(parsed.__preflight).toBe(true)
    expect(parsed.error).toBe('X 오류')
    expect(parsed.suggestion).toBe('Y 시도')
  })
})
