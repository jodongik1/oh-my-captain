import { describe, it, expect } from 'vitest'
import { TextToolCallFilter } from '../text_tool_call_filter.js'

describe('TextToolCallFilter', () => {
  it('마커가 없는 일반 텍스트는 그대로 반환한다', () => {
    const f = new TextToolCallFilter()
    expect(f.feed('hello world')).toBe('hello world')
    expect(f.feed(' another chunk')).toBe(' another chunk')
    expect(f.flush()).toBe('')
    expect(f.parsedToolCalls).toEqual([])
  })

  it('<tool_call>{...}</tool_call> JSON 포맷을 감지하고 구조화한다', () => {
    const f = new TextToolCallFilter()
    expect(f.feed('<tool_call>')).toBe('')
    expect(f.feed('{"name":"read","arguments":{"path":"/a"}}')).toBe('')
    expect(f.feed('</tool_call>')).toBe('')
    expect(f.flush()).toBe('')
    expect(f.parsedToolCalls).toHaveLength(1)
    expect(f.parsedToolCalls[0].function.name).toBe('read')
    expect(f.parsedToolCalls[0].function.arguments).toEqual({ path: '/a' })
  })

  it('<function=name><parameter=k>v</parameter></function> XML 포맷을 파싱한다', () => {
    const f = new TextToolCallFilter()
    f.feed('<function=grep>')
    f.feed('<parameter=pattern>foo</parameter>')
    expect(f.feed('</function>')).toBe('')
    expect(f.parsedToolCalls).toHaveLength(1)
    expect(f.parsedToolCalls[0].function.name).toBe('grep')
    expect(f.parsedToolCalls[0].function.arguments).toEqual({ pattern: 'foo' })
  })

  it('마커가 두 토큰에 걸쳐 올 때 부분 매칭을 보류한다', () => {
    const f = new TextToolCallFilter()
    expect(f.feed('prefix <tool_')).toBe('prefix ')
    expect(f.feed('call>')).toBe('')
    f.feed('{"name":"x","arguments":{}}')
    expect(f.feed('</tool_call>')).toBe('')
    expect(f.parsedToolCalls).toHaveLength(1)
    expect(f.parsedToolCalls[0].function.name).toBe('x')
  })

  it('마커 없이 단독으로 나타난 </tool_call>을 필터링한다', () => {
    const f = new TextToolCallFilter()
    expect(f.feed('text </tool_call> more')).toBe('text  more')
    expect(f.parsedToolCalls).toEqual([])
  })

  it('열림만 있고 닫힘 없이 flush되면 내용을 드롭한다', () => {
    const f = new TextToolCallFilter()
    f.feed('<tool_call>')
    f.feed('{"name":"x",')
    expect(f.flush()).toBe('')
    expect(f.parsedToolCalls).toEqual([])
  })

  it('파싱 실패한 tool_call 블록은 조용히 무시한다', () => {
    const f = new TextToolCallFilter()
    f.feed('<tool_call>')
    f.feed('not valid json')
    expect(f.feed('</tool_call>')).toBe('')
    expect(f.parsedToolCalls).toEqual([])
  })
})
