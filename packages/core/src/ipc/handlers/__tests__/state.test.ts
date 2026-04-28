import { describe, it, expect } from 'vitest'
import { RunState, createState } from '../state.js'

describe('RunState', () => {
  it('beginRun 시작 시 busy=true, 종료 후 busy=false 와 currentRun=null', async () => {
    const r = new RunState()
    expect(r.busy).toBe(false)
    expect(r.currentRun).toBeNull()

    let resolveWork: (() => void) | undefined
    const workPromise = new Promise<void>((res) => { resolveWork = res })
    const runPromise = r.beginRun(() => workPromise)

    expect(r.busy).toBe(true)
    expect(r.currentRun).not.toBeNull()

    resolveWork!()
    await runPromise

    expect(r.busy).toBe(false)
    expect(r.currentRun).toBeNull()
  })

  it('work 가 throw 해도 busy/currentRun 가 정리된다', async () => {
    const r = new RunState()
    await expect(r.beginRun(async () => { throw new Error('boom') })).rejects.toThrow('boom')
    expect(r.busy).toBe(false)
    expect(r.currentRun).toBeNull()
  })

  it('abortAndWait 는 진행 중 run 이 없으면 즉시 반환', async () => {
    const r = new RunState()
    await expect(r.abortAndWait()).resolves.toBeUndefined()
  })

  it('abortAndWait 는 진행 중 run 의 controller.abort 후 종료까지 대기', async () => {
    const r = new RunState()
    let signalSeen: AbortSignal | undefined
    let resolveWork: (() => void) | undefined
    const workPromise = new Promise<void>((res) => { resolveWork = res })

    const _ = r.beginRun(async () => {
      signalSeen = r.loopController.start()
      await workPromise
    })

    // 작업 진행 중
    expect(r.busy).toBe(true)

    // abortAndWait 가 호출되면 abort 가 먼저 발사되고, work 가 끝나길 기다림
    const aborter = r.abortAndWait()
    // work 를 종료시켜야 abortAndWait 가 resolve
    setTimeout(() => resolveWork!(), 5)
    await aborter

    expect(signalSeen?.aborted).toBe(true)
    expect(r.busy).toBe(false)
    expect(r.currentRun).toBeNull()
  })

  it('createState 가 기본값으로 RunState 와 빈 history 를 가진다', () => {
    const s = createState()
    expect(s.host).toBeNull()
    expect(s.provider).toBeNull()
    expect(s.sessionId).toBeNull()
    expect(s.history).toEqual([])
    expect(s.run).toBeInstanceOf(RunState)
    expect(s.run.busy).toBe(false)
  })
})
