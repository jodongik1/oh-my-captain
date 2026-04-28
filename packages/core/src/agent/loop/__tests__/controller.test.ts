import { describe, it, expect } from 'vitest'
import { LoopController } from '../controller.js'

describe('LoopController', () => {
  it('start() 는 abort 가능한 signal 반환', () => {
    const c = new LoopController()
    const signal = c.start()
    expect(signal.aborted).toBe(false)
    c.abort()
    expect(signal.aborted).toBe(true)
  })

  it('start() 두 번 호출 시 새 signal — 이전 signal 은 abort 되지 않음', () => {
    const c = new LoopController()
    const s1 = c.start()
    const s2 = c.start()
    expect(s1).not.toBe(s2)
    c.abort()
    expect(s2.aborted).toBe(true)
    expect(s1.aborted).toBe(false)  // 이전 인스턴스는 영향 없음
  })

  it('injectSteering / drainSteering — 큐 동작', () => {
    const c = new LoopController()
    expect(c.drainSteering()).toEqual([])
    c.injectSteering('A')
    c.injectSteering('B')
    expect(c.drainSteering()).toEqual(['A', 'B'])
    expect(c.drainSteering()).toEqual([])  // drain 후 비어있음
  })

  it('서로 다른 인스턴스는 독립적 (다중 세션 가능)', () => {
    const c1 = new LoopController()
    const c2 = new LoopController()
    const s1 = c1.start()
    const s2 = c2.start()
    c1.injectSteering('only-c1')
    c1.abort()
    expect(s1.aborted).toBe(true)
    expect(s2.aborted).toBe(false)  // c2 는 영향 없음
    expect(c2.drainSteering()).toEqual([])  // c2 큐는 별개
  })

  it('start() 호출 없이 abort() 해도 에러 없음 (no-op)', () => {
    const c = new LoopController()
    expect(() => c.abort()).not.toThrow()
  })
})
