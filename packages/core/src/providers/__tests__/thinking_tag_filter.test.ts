import { describe, it, expect } from 'vitest'
import { ThinkingTagFilter, stripThinkingTags, splitThinkingTags } from '../thinking_tag_filter.js'

describe('ThinkingTagFilter', () => {
  it('thinking 블록 안의 텍스트는 uiText 로 흘리지 않는다', () => {
    const f = new ThinkingTagFilter()
    const r = f.feed('답변 시작 <thinking>비밀 사고</thinking> 답변 끝')
    expect(r.uiText).toBe('답변 시작  답변 끝')
    expect(r.thinkingText).toBe('비밀 사고')
  })

  it('thinking 블록이 여러 청크에 나뉘어 와도 정확히 분리', () => {
    const f = new ThinkingTagFilter()
    const out: { ui: string; think: string } = { ui: '', think: '' }
    for (const chunk of ['hello <thi', 'nking>plan', ' here</thi', 'nking>world']) {
      const r = f.feed(chunk)
      out.ui += r.uiText
      out.think += r.thinkingText
    }
    const tail = f.flush()
    out.ui += tail.uiText
    out.think += tail.thinkingText
    expect(out.ui).toBe('hello world')
    expect(out.think).toBe('plan here')
  })

  it('시작 태그가 partial 로 들어와도 깨지지 않는다', () => {
    const f = new ThinkingTagFilter()
    const r1 = f.feed('answer <th')
    expect(r1.uiText).toBe('answer ')
    const r2 = f.feed('inking>x</thinking>!')
    expect(r2.uiText).toBe('!')
    expect(r2.thinkingText).toBe('x')
  })

  it('thinking 태그 없는 토큰은 그대로 통과', () => {
    const f = new ThinkingTagFilter()
    const r = f.feed('plain text without tags')
    expect(r.uiText).toBe('plain text without tags')
    expect(r.thinkingText).toBe('')
  })

  it('닫히지 않은 채 스트림 종료 시 내부 내용은 폐기', () => {
    const f = new ThinkingTagFilter()
    f.feed('begin <thinking>truncated mid-')
    const tail = f.flush()
    expect(tail.uiText).toBe('')
    expect(tail.thinkingText).toBe('')
  })

  it('연속된 thinking 블록 두 개 처리', () => {
    const f = new ThinkingTagFilter()
    const r = f.feed('<thinking>a</thinking>중간<thinking>b</thinking>끝')
    expect(r.uiText).toBe('중간끝')
    expect(r.thinkingText).toBe('ab')
  })
})

describe('splitThinkingTags', () => {
  it('content 와 thinking 을 동시에 추출', () => {
    const r = splitThinkingTags('<thinking>reasoning</thinking>본문 텍스트')
    expect(r.content).toBe('본문 텍스트')
    expect(r.thinking).toBe('reasoning')
  })

  it('답변이 통째로 thinking 안에 있을 때 thinking 캡처', () => {
    const r = splitThinkingTags('<thinking>## 시퀀스 다이어그램\nclient->server</thinking>')
    expect(r.content).toBe('')
    expect(r.thinking).toContain('시퀀스 다이어그램')
  })

  it('미완성 thinking 도 캡처 (열림만 있음)', () => {
    const r = splitThinkingTags('<thinking>중간에 끊김')
    expect(r.content).toBe('')
    expect(r.thinking).toBe('중간에 끊김')
  })

  it('여러 thinking 블록을 합쳐 반환', () => {
    const r = splitThinkingTags('<thinking>a</thinking>본문<thinking>b</thinking>')
    expect(r.content).toBe('본문')
    expect(r.thinking).toContain('a')
    expect(r.thinking).toContain('b')
  })
})

describe('stripThinkingTags', () => {
  it('완성된 thinking 블록 제거', () => {
    expect(stripThinkingTags('<thinking>x</thinking>본문')).toBe('본문')
  })

  it('미완성 thinking 블록도 제거 (열림만 있음)', () => {
    expect(stripThinkingTags('본문 시작 <thinking>중간에 끊김')).toBe('본문 시작 ')
  })

  it('thinking 없는 텍스트는 그대로', () => {
    expect(stripThinkingTags('  hello  ')).toBe('hello  ')
  })
})
