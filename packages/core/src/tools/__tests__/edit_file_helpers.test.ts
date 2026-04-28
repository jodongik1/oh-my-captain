import { describe, it, expect } from 'vitest'
import {
  countOccurrences,
  applyLineRangeEdit,
  applyOldStringEdit,
  tryNormalizedMatch,
  findNearestLines,
} from '../edit_file_helpers.js'

describe('countOccurrences', () => {
  it('기본 동작', () => {
    expect(countOccurrences('aaa', 'a')).toBe(3)
    expect(countOccurrences('foofoofoo', 'foo')).toBe(3)
    expect(countOccurrences('abc', 'x')).toBe(0)
  })
  it('빈 문자열은 0', () => {
    expect(countOccurrences('hello', '')).toBe(0)
  })
})

describe('applyLineRangeEdit', () => {
  const content = ['line1', 'line2', 'line3', 'line4', 'line5'].join('\n')

  it('정상 범위 교체', () => {
    const out = applyLineRangeEdit(content, { startLine: 2, endLine: 3, new_string: 'REPLACED' })
    expect(out.kind).toBe('ok')
    if (out.kind !== 'ok') return
    expect(out.newContent).toBe(['line1', 'REPLACED', 'line4', 'line5'].join('\n'))
    expect(out.replacements).toBe(1)
  })

  it('startLine < 1 은 에러', () => {
    const out = applyLineRangeEdit(content, { startLine: 0, endLine: 2, new_string: 'X' })
    expect(out.kind).toBe('error')
  })

  it('endLine > 파일 길이는 에러', () => {
    const out = applyLineRangeEdit(content, { startLine: 1, endLine: 999, new_string: 'X' })
    expect(out.kind).toBe('error')
  })

  it('startLine > endLine 은 에러', () => {
    const out = applyLineRangeEdit(content, { startLine: 4, endLine: 2, new_string: 'X' })
    expect(out.kind).toBe('error')
  })

  it('한 줄만 교체', () => {
    const out = applyLineRangeEdit(content, { startLine: 1, endLine: 1, new_string: 'first' })
    expect(out.kind).toBe('ok')
    if (out.kind !== 'ok') return
    expect(out.newContent.split('\n')[0]).toBe('first')
  })
})

describe('applyOldStringEdit', () => {
  const content = 'aaa\nbbb\nccc\nbbb'

  it('단일 매칭 — 첫 번째만 교체', () => {
    const out = applyOldStringEdit(content, { old_string: 'aaa', new_string: 'A', replace_all: false })
    expect(out.kind).toBe('ok')
    if (out.kind !== 'ok') return
    expect(out.newContent).toBe('A\nbbb\nccc\nbbb')
    expect(out.replacements).toBe(1)
  })

  it('중복 매칭 + replace_all=false → 에러', () => {
    const out = applyOldStringEdit(content, { old_string: 'bbb', new_string: 'B', replace_all: false })
    expect(out.kind).toBe('error')
    if (out.kind !== 'error') return
    expect(out.occurrences).toBe(2)
  })

  it('중복 매칭 + replace_all=true → 모두 교체', () => {
    const out = applyOldStringEdit(content, { old_string: 'bbb', new_string: 'B', replace_all: true })
    expect(out.kind).toBe('ok')
    if (out.kind !== 'ok') return
    expect(out.newContent).toBe('aaa\nB\nccc\nB')
    expect(out.replacements).toBe(2)
  })

  it('매칭 없음 → 에러 + nearest 힌트', () => {
    const out = applyOldStringEdit(content, { old_string: 'NOT_FOUND', new_string: 'X', replace_all: false })
    expect(out.kind).toBe('error')
    if (out.kind !== 'error') return
    expect(out.error).toContain('찾을 수 없습니다')
  })

  it('CRLF 차이는 정규화 폴백으로 매칭', () => {
    const crlfContent = 'aaa\r\nbbb\r\nccc'
    const out = applyOldStringEdit(crlfContent, { old_string: 'aaa\nbbb', new_string: 'XX', replace_all: false })
    expect(out.kind).toBe('ok')
    if (out.kind !== 'ok') return
    expect(out.fallbackStrategy).toBe('crlf')
  })

  it('trailing whitespace 차이도 폴백으로 매칭', () => {
    const trailingContent = 'aaa   \nbbb\n'
    const out = applyOldStringEdit(trailingContent, { old_string: 'aaa\nbbb', new_string: 'XX', replace_all: false })
    expect(out.kind).toBe('ok')
    if (out.kind !== 'ok') return
    expect(out.fallbackStrategy).toBe('trailing-whitespace')
  })
})

describe('tryNormalizedMatch', () => {
  it('정확 매칭이면 첫 번째 전략에서 통과', () => {
    const r = tryNormalizedMatch('hello world', 'hello', 'HELLO', false)
    expect(r.result?.strategy).toBe('crlf')
    expect(r.result?.newContent).toBe('HELLO world')
  })

  it('두 전략 모두 실패하면 null', () => {
    const r = tryNormalizedMatch('hello world', 'XYZ', 'X', false)
    expect(r.result).toBeNull()
    expect(r.diagnostics.length).toBe(2)
  })
})

describe('findNearestLines', () => {
  const content = ['function foo() {', '  const a = 1', '  return a', '}', '', 'function bar() {', '  return 2', '}'].join('\n')

  it('첫 줄이 일치하는 영역의 윈도우를 반환', () => {
    const result = findNearestLines(content, 'function bar() {\n  return 99\n}')
    expect(result).toBeTruthy()
    expect(result).toContain('function bar()')
  })

  it('일치 없으면 null', () => {
    const result = findNearestLines(content, 'class Nothing {\n  prop\n}')
    expect(result).toBeNull()
  })

  it('빈 oldStr 첫 줄은 null', () => {
    const result = findNearestLines(content, '\n\n')
    expect(result).toBeNull()
  })
})
