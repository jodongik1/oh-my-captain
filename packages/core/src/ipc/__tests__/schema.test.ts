import { describe, it, expect } from 'vitest'
import { parseIpcMessage } from '../schema.js'

describe('parseIpcMessage', () => {
  it('정상 봉투는 통과', () => {
    expect(parseIpcMessage({ id: 'a', type: 'init', payload: {} })).toEqual({
      id: 'a',
      type: 'init',
      payload: {},
    })
  })

  it('payload 가 임의의 형태여도 통과 (세부 검증은 핸들러 책임)', () => {
    expect(parseIpcMessage({ id: 'a', type: 't', payload: { nested: { x: 1 } } })).toBeTruthy()
    expect(parseIpcMessage({ id: 'a', type: 't', payload: 'string-payload' })).toBeTruthy()
    expect(parseIpcMessage({ id: 'a', type: 't', payload: null })).toBeTruthy()
  })

  it('id 가 빠지면 null', () => {
    expect(parseIpcMessage({ type: 't', payload: {} })).toBeNull()
  })

  it('id 가 빈 문자열이면 null', () => {
    expect(parseIpcMessage({ id: '', type: 't', payload: {} })).toBeNull()
  })

  it('type 이 빠지면 null', () => {
    expect(parseIpcMessage({ id: 'a', payload: {} })).toBeNull()
  })

  it('type 이 숫자면 null', () => {
    expect(parseIpcMessage({ id: 'a', type: 42, payload: {} })).toBeNull()
  })

  it('non-object 는 null', () => {
    expect(parseIpcMessage(null)).toBeNull()
    expect(parseIpcMessage('string')).toBeNull()
    expect(parseIpcMessage(42)).toBeNull()
  })
})
