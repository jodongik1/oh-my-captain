import { describe, it, expect } from 'vitest'
import { TextToolCallFilter } from '../text_tool_call_filter.js'

function feedAll(filter: TextToolCallFilter, tokens: string[]): string {
  let out = ''
  for (const t of tokens) out += filter.feed(t)
  out += filter.flush()
  return out
}

describe('TextToolCallFilter — 기본 케이스', () => {
  it('일반 텍스트는 그대로 통과', () => {
    const f = new TextToolCallFilter()
    expect(feedAll(f, ['hello ', 'world'])).toBe('hello world')
    expect(f.parsedToolCalls).toEqual([])
  })

  it('<tool_call>JSON</tool_call> 블록을 흡수하고 파싱', () => {
    const f = new TextToolCallFilter()
    const safe = feedAll(f, [
      'pre ',
      '<tool_call>{"name":"read_file","arguments":{"path":"a"}}</tool_call>',
      ' post',
    ])
    expect(safe).toBe('pre  post')
    expect(f.parsedToolCalls).toHaveLength(1)
    expect(f.parsedToolCalls[0].function.name).toBe('read_file')
    expect(f.parsedToolCalls[0].function.arguments).toEqual({ path: 'a' })
  })

  it('<function=name>...</function> 블록을 흡수하고 파싱', () => {
    const f = new TextToolCallFilter()
    const safe = feedAll(f, [
      '<function=grep_tool><parameter=pattern>foo</parameter><parameter=path>src</parameter></function>',
    ])
    expect(safe).toBe('')
    expect(f.parsedToolCalls).toHaveLength(1)
    expect(f.parsedToolCalls[0].function.name).toBe('grep_tool')
    expect(f.parsedToolCalls[0].function.arguments).toEqual({ pattern: 'foo', path: 'src' })
  })
})

describe('TextToolCallFilter — 공백 변형', () => {
  it('<function = name > 공백 양쪽 변형 매칭', () => {
    const f = new TextToolCallFilter()
    const safe = feedAll(f, [
      '<function = read_file ><parameter=path>x</parameter></function>',
    ])
    expect(safe).toBe('')
    expect(f.parsedToolCalls).toHaveLength(1)
    expect(f.parsedToolCalls[0].function.name).toBe('read_file')
    expect(f.parsedToolCalls[0].function.arguments).toEqual({ path: 'x' })
  })

  it('< function = name > 시작에 공백이 있는 변형도 매칭', () => {
    const f = new TextToolCallFilter()
    const safe = feedAll(f, [
      '< function = list_dir ><parameter=path>.</parameter></function>',
    ])
    expect(safe).toBe('')
    expect(f.parsedToolCalls).toHaveLength(1)
    expect(f.parsedToolCalls[0].function.name).toBe('list_dir')
  })

  it('파라미터 태그 공백 변형도 흡수', () => {
    const f = new TextToolCallFilter()
    const safe = feedAll(f, [
      '<function=read_file><parameter = path > x </parameter></function>',
    ])
    expect(safe).toBe('')
    expect(f.parsedToolCalls).toHaveLength(1)
    expect(f.parsedToolCalls[0].function.arguments).toEqual({ path: 'x' })
  })
})

describe('TextToolCallFilter — 토큰 경계 partial-match', () => {
  it('마커가 토큰 경계에서 잘려도 buffer 후 정상 매칭', () => {
    const f = new TextToolCallFilter()
    const safe = feedAll(f, [
      'pre',
      '<func',
      'tion=re',
      'ad_file><parameter=path>',
      'a</parameter></function>',
      'post',
    ])
    expect(safe).toBe('prepost')
    expect(f.parsedToolCalls).toHaveLength(1)
    expect(f.parsedToolCalls[0].function.name).toBe('read_file')
  })

  it('< 만 끝에 있는 일반 텍스트는 보류 후 다음 토큰에 합쳐 흘려보냄', () => {
    const f = new TextToolCallFilter()
    let out = f.feed('a < ')
    out += f.feed('b')
    out += f.flush()
    expect(out).toBe('a < b')
    expect(f.parsedToolCalls).toEqual([])
  })

  it('마커처럼 보이지만 실제론 일반 텍스트(<function 만 있고 = 없음)도 결국 흘려보냄', () => {
    const f = new TextToolCallFilter()
    const out = feedAll(f, ['<function name="x">code</function>'])
    expect(out).toContain('<function name="x">')
    expect(f.parsedToolCalls).toEqual([])
  })

  it('미닫힌 도구 블록은 flush 시점에 드롭', () => {
    const f = new TextToolCallFilter()
    f.feed('<function=read_file><parameter=path>a</parameter>')
    const out = f.flush()
    // 도구 블록이 닫히지 않았으므로 드롭 (UI 누출 방지)
    expect(out).toBe('')
    expect(f.parsedToolCalls).toEqual([])
  })

  it('고아 닫힘 태그 </function> 단독 등장 시 제거', () => {
    const f = new TextToolCallFilter()
    const out = feedAll(f, ['hello </function> world'])
    expect(out).toBe('hello  world')
  })
})

describe('TextToolCallFilter — 다중 호출', () => {
  it('연속된 두 도구 호출 모두 추출', () => {
    const f = new TextToolCallFilter()
    feedAll(f, [
      '<function=read_file><parameter=path>a</parameter></function>',
      '<function=read_file><parameter=path>b</parameter></function>',
    ])
    expect(f.parsedToolCalls).toHaveLength(2)
    expect(f.parsedToolCalls[0].function.arguments).toEqual({ path: 'a' })
    expect(f.parsedToolCalls[1].function.arguments).toEqual({ path: 'b' })
  })
})
