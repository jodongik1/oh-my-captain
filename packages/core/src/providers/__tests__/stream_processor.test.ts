import { describe, it, expect } from 'vitest'
import { BasicStreamProcessor, XmlFilteringStreamProcessor } from '../stream_processor.js'
import type { StreamChunk } from '../types.js'

function collectChunks() {
  const tokens: string[] = []
  const thinkings: string[] = []
  return {
    onChunk: (c: StreamChunk) => {
      if (c.token) tokens.push(c.token)
      if (c.thinking) thinkings.push(c.thinking)
    },
    tokens,
    thinkings,
  }
}

describe('BasicStreamProcessor', () => {
  it('일반 텍스트 토큰은 그대로 forward 한다', () => {
    const p = new BasicStreamProcessor()
    const { onChunk, tokens } = collectChunks()
    p.feedText('hello', onChunk)
    p.feedText(' world', onChunk)
    p.flush(onChunk)
    expect(tokens.join('')).toBe('hello world')
  })

  it('extractedToolCalls 는 항상 빈 배열 (native tool_use 와 중복 방지)', () => {
    const p = new BasicStreamProcessor()
    expect(p.extractedToolCalls).toEqual([])
  })

  it('스트리밍 중 <function=...> XML 도구호출 토큰이 UI 로 누출되지 않는다', () => {
    const p = new BasicStreamProcessor()
    const { onChunk, tokens } = collectChunks()
    p.feedText('답변: ', onChunk)
    p.feedText('<function=read_file><parameter=path>a</parameter></function>', onChunk)
    p.feedText(' 끝', onChunk)
    p.flush(onChunk)
    const joined = tokens.join('')
    expect(joined).toContain('답변')
    expect(joined).toContain('끝')
    expect(joined).not.toContain('<function=')
    expect(joined).not.toContain('parameter=')
  })

  it('스트리밍 중 <tool_call>JSON</tool_call> 토큰이 UI 로 누출되지 않는다', () => {
    const p = new BasicStreamProcessor()
    const { onChunk, tokens } = collectChunks()
    p.feedText('hi <tool_call>{"name":"x","arguments":{}}</tool_call> bye', onChunk)
    p.flush(onChunk)
    const joined = tokens.join('')
    expect(joined).toContain('hi')
    expect(joined).toContain('bye')
    expect(joined).not.toContain('tool_call')
  })

  it('공백 변형 <function = name> 도 UI 누출 없이 흡수된다', () => {
    const p = new BasicStreamProcessor()
    const { onChunk, tokens } = collectChunks()
    p.feedText('start ', onChunk)
    p.feedText('<function = read_file ><parameter=path>x</parameter></function>', onChunk)
    p.feedText(' end', onChunk)
    p.flush(onChunk)
    const joined = tokens.join('')
    expect(joined).toContain('start')
    expect(joined).toContain('end')
    expect(joined).not.toMatch(/<\s*function/)
  })

  it('sanitizeContent 가 <tool_call>·<function=...> XML 블록을 제거', () => {
    const p = new BasicStreamProcessor()
    expect(p.sanitizeContent('a <tool_call>x</tool_call> b')).toBe('a  b')
    expect(p.sanitizeContent('a <function=fn><parameter=p>v</parameter></function> b')).toBe('a  b')
    expect(p.sanitizeContent('a <function = fn ><parameter=p>v</parameter></function> b')).toBe('a  b')
  })

  it('thinking 토큰은 별도 채널, 본문 빈 응답은 sanitizeContent 가 thinking 으로 폴백', () => {
    const p = new BasicStreamProcessor()
    const { onChunk, tokens, thinkings } = collectChunks()
    p.feedText('<thinking>속생각 본문 답변 다이어그램</thinking>', onChunk)
    p.flush(onChunk)
    expect(tokens.join('')).toBe('')
    expect(thinkings.join('')).toContain('속생각')
    // sanitizeContent 가 thinking 을 본문으로 승격
    expect(p.sanitizeContent('<thinking>속생각 본문 답변 다이어그램</thinking>'))
      .toContain('속생각')
  })
})

describe('XmlFilteringStreamProcessor', () => {
  it('일반 텍스트는 통과시키고 tool_call XML 은 필터링', () => {
    const p = new XmlFilteringStreamProcessor()
    const { onChunk, tokens } = collectChunks()
    p.feedText('hello ', onChunk)
    p.feedText('<tool_call>{"name":"foo","arguments":{}}</tool_call>', onChunk)
    p.feedText(' world', onChunk)
    p.flush(onChunk)
    const joined = tokens.join('')
    expect(joined).toContain('hello')
    expect(joined).toContain('world')
    expect(joined).not.toContain('tool_call')
  })

  it('sanitizeContent 가 <tool_call> 블록 제거 (공백 변형 포함)', () => {
    const p = new XmlFilteringStreamProcessor()
    expect(p.sanitizeContent('a <tool_call>x</tool_call> b')).toBe('a  b')
    expect(p.sanitizeContent('a </tool_call> b')).toBe('a  b')
    expect(p.sanitizeContent('a <function = fn ><parameter=p>v</parameter></function> b')).toBe('a  b')
  })

  it('XML 도구호출이 parsedToolCalls 에 추출된다 (스트리밍 청크)', () => {
    const p = new XmlFilteringStreamProcessor()
    const { onChunk } = collectChunks()
    p.feedText('<tool_call>{"name":"read_file",', onChunk)
    p.feedText('"arguments":{"path":"a"}}', onChunk)
    p.feedText('</tool_call>', onChunk)
    p.flush(onChunk)
    expect(p.extractedToolCalls.length).toBe(1)
    expect(p.extractedToolCalls[0].function.name).toBe('read_file')
    expect(p.extractedToolCalls[0].function.arguments).toEqual({ path: 'a' })
  })

  it('<function=...> 포맷의 도구호출이 공백 변형까지 추출된다', () => {
    const p = new XmlFilteringStreamProcessor()
    const { onChunk } = collectChunks()
    p.feedText('<function = read_file ><parameter=path>src/a.ts</parameter></function>', onChunk)
    p.flush(onChunk)
    expect(p.extractedToolCalls.length).toBe(1)
    expect(p.extractedToolCalls[0].function.name).toBe('read_file')
    expect(p.extractedToolCalls[0].function.arguments).toEqual({ path: 'src/a.ts' })
  })
})
