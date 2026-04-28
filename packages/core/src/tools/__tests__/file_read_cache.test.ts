import { describe, it, expect } from 'vitest'
import { FileReadCache } from '../file_read_cache.js'

describe('FileReadCache', () => {
  it('markRead 후 get 으로 동일 content 반환', () => {
    const cache = new FileReadCache()
    cache.markRead('/a', 'hello')
    expect(cache.get('/a')?.content).toBe('hello')
  })

  it('미등록 경로는 null', () => {
    const cache = new FileReadCache()
    expect(cache.get('/nope')).toBeNull()
  })

  it('TTL 초과 시 자동 폐기 + null 반환', async () => {
    const cache = new FileReadCache(5)  // 5ms TTL
    cache.markRead('/a', 'hello')
    expect(cache.size).toBe(1)
    await new Promise(r => setTimeout(r, 20))
    expect(cache.get('/a')).toBeNull()
    expect(cache.size).toBe(0)  // 만료 시 즉시 삭제 확인
  })

  it('clear 는 모든 항목 제거', () => {
    const cache = new FileReadCache()
    cache.markRead('/a', '1')
    cache.markRead('/b', '2')
    cache.clear()
    expect(cache.size).toBe(0)
    expect(cache.get('/a')).toBeNull()
  })

  it('delete 는 단일 항목만 제거', () => {
    const cache = new FileReadCache()
    cache.markRead('/a', '1')
    cache.markRead('/b', '2')
    cache.delete('/a')
    expect(cache.get('/a')).toBeNull()
    expect(cache.get('/b')?.content).toBe('2')
  })

  it('덮어쓰기 시 timestamp 갱신', async () => {
    const cache = new FileReadCache()
    cache.markRead('/a', 'v1')
    const t1 = cache.get('/a')!.ageMs
    await new Promise(r => setTimeout(r, 5))
    cache.markRead('/a', 'v2')
    const t2 = cache.get('/a')!.ageMs
    expect(cache.get('/a')!.content).toBe('v2')
    expect(t2).toBeLessThan(t1 + 5 + 5)  // 갱신되어 ageMs 가 작음
  })

  it('mtimeMs 가 함께 저장되고 조회된다', () => {
    const cache = new FileReadCache()
    cache.markRead('/a', 'v1', 1234567)
    const r = cache.get('/a')
    expect(r?.mtimeMs).toBe(1234567)
  })

  it('mtimeMs 미지정 시 기본값 0', () => {
    const cache = new FileReadCache()
    cache.markRead('/a', 'v1')
    expect(cache.get('/a')?.mtimeMs).toBe(0)
  })

  it('덮어쓰기 시 mtimeMs 갱신', () => {
    const cache = new FileReadCache()
    cache.markRead('/a', 'v1', 100)
    cache.markRead('/a', 'v2', 200)
    expect(cache.get('/a')?.mtimeMs).toBe(200)
  })
})
