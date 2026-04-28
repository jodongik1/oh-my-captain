import { describe, it, expect } from 'vitest'
import { Readable, Writable } from 'stream'
import { IpcServer } from '../server.js'

function makeStreams() {
  const writes: string[] = []
  const output = new Writable({
    write(chunk, _enc, cb) {
      writes.push(chunk.toString())
      cb()
    },
  })
  return { writes, output }
}

describe('IpcServer', () => {
  it('handleLine — 정상 메시지를 등록된 핸들러에 라우팅', () => {
    const { writes, output } = makeStreams()
    const server = new IpcServer({ input: new Readable(), output })

    let received: unknown = null
    server.registerHandler('user_message', (msg) => { received = msg })
    server.handleLine(JSON.stringify({ id: 'a', type: 'user_message', payload: { text: 'hi' } }))

    expect(received).toEqual({ id: 'a', type: 'user_message', payload: { text: 'hi' } })
    expect(writes).toEqual([])  // 핸들러가 직접 reply 하지 않음
  })

  it('handleLine — 봉투 검증 실패 시 핸들러 호출 안 함', () => {
    const { output } = makeStreams()
    const server = new IpcServer({ input: new Readable(), output })

    let called = false
    server.registerHandler('user_message', () => { called = true })
    server.handleLine(JSON.stringify({ type: 'user_message', payload: {} }))  // id 누락

    expect(called).toBe(false)
  })

  it('handleLine — JSON 파싱 실패 시 무시', () => {
    const { output } = makeStreams()
    const server = new IpcServer({ input: new Readable(), output })

    let called = false
    server.registerHandler('user_message', () => { called = true })
    server.handleLine('not-json{{{')

    expect(called).toBe(false)
  })

  it('handleLine — 빈 라인은 무시', () => {
    const { output } = makeStreams()
    const server = new IpcServer({ input: new Readable(), output })

    let called = false
    server.registerHandler('user_message', () => { called = true })
    server.handleLine('   ')
    server.handleLine('')

    expect(called).toBe(false)
  })

  it('emit — type-safe payload 를 stdout 에 JSON+newline 으로 기록', () => {
    const { writes, output } = makeStreams()
    const server = new IpcServer({ input: new Readable(), output })

    server.emit('msg-1', 'ready', {})
    expect(writes).toHaveLength(1)
    const parsed = JSON.parse(writes[0])
    expect(parsed).toEqual({ id: 'msg-1', type: 'ready', payload: {} })
    expect(writes[0].endsWith('\n')).toBe(true)
  })

  it('request — pendingRequests 에 등록되고, 동일 id 응답이 오면 resolve', async () => {
    const { writes, output } = makeStreams()
    const server = new IpcServer({ input: new Readable(), output })

    const promise = server.request<{ result: number }>({
      id: 'r-1',
      type: 'context_request',
      payload: { paths: [] },
    })

    expect(writes).toHaveLength(1)  // 요청 송신됨

    // host 가 응답을 보내는 것을 시뮬레이션
    server.handleLine(JSON.stringify({ id: 'r-1', type: 'context_response', payload: { result: 42 } }))

    const resolved = await promise
    expect(resolved).toEqual({ result: 42 })
  })

  it('두 인스턴스는 핸들러/pending 이 독립적', () => {
    const a = new IpcServer({ input: new Readable(), output: makeStreams().output })
    const b = new IpcServer({ input: new Readable(), output: makeStreams().output })

    let aCalled = 0
    let bCalled = 0
    a.registerHandler('user_message', () => { aCalled++ })
    b.registerHandler('user_message', () => { bCalled++ })

    a.handleLine(JSON.stringify({ id: '1', type: 'user_message', payload: {} }))
    expect(aCalled).toBe(1)
    expect(bCalled).toBe(0)
  })
})
