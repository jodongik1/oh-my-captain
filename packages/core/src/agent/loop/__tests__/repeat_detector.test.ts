import { describe, it, expect } from 'vitest'
import { RepeatToolDetector } from '../repeat_detector.js'
import type { ToolCall } from '../../../providers/types.js'

const call = (name: string, idx = 0): ToolCall => ({
  id: `call-${name}-${idx}`,
  function: { name, arguments: {} },
})

describe('RepeatToolDetector', () => {
  it('서로 다른 도구가 섞여 있으면 카운터가 누적되지 않는다', () => {
    const d = new RepeatToolDetector()
    expect(d.observe([call('list_dir'), call('read_file')]).hints).toEqual([])
    expect(d.observe([call('list_dir'), call('grep_tool')]).hints).toEqual([])
    expect(d.disabledTools.size).toBe(0)
  })

  it('동일 도구 4회 연속 호출 시 부드러운 hint 를 발사한다', () => {
    const d = new RepeatToolDetector()
    expect(d.observe([call('list_dir')]).hints.length).toBe(0)  // 1
    expect(d.observe([call('list_dir')]).hints.length).toBe(0)  // 2
    expect(d.observe([call('list_dir')]).hints.length).toBe(0)  // 3
    const obs = d.observe([call('list_dir')])                    // 4
    expect(obs.hints.length).toBe(1)
    expect(obs.hints[0].role).toBe('system')
    expect(obs.consecutiveSameTool).toBe(true)
    expect(d.disabledTools.has('list_dir')).toBe(false)
  })

  it('동일 도구 7회 연속 호출 시 차단 + 종결 hint 를 발사한다', () => {
    const d = new RepeatToolDetector()
    for (let i = 0; i < 6; i++) d.observe([call('read_file', i)])
    const obs = d.observe([call('read_file', 6)])
    expect(obs.hints.length).toBe(1)
    expect(d.disabledTools.has('read_file')).toBe(true)
  })

  it('한 turn 안에 같은 도구가 여러 번 호출되면 호출 수만큼 카운트된다', () => {
    const d = new RepeatToolDetector()
    // 4번 한 turn 안에 호출 → 즉시 hint
    const obs = d.observe([
      call('list_dir', 0),
      call('list_dir', 1),
      call('list_dir', 2),
      call('list_dir', 3),
    ])
    expect(obs.hints.length).toBe(1)
  })

  it('차단된 도구는 disabledTools 에 한 번만 추가된다', () => {
    const d = new RepeatToolDetector()
    for (let i = 0; i < 10; i++) d.observe([call('read_file', i)])
    expect(d.disabledTools.size).toBe(1)
  })
})
