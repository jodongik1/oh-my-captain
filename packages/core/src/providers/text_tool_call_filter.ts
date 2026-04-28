/**
 * 일부 모델(Qwen 등)은 structured tool_calls API 대신
 * 텍스트 스트림에 XML 형태로 도구 호출을 삽입합니다.
 *
 * 지원 포맷:
 *   1) <tool_call>{"name":"fn","arguments":{...}}</tool_call>
 *   2) <function=fn><parameter=p>v</parameter></function>
 *
 * 이 클래스는 스트리밍 중에 해당 패턴을 감지하고:
 *   - 도구 호출 텍스트는 UI로 보내지 않고 내부 버퍼에 저장
 *   - 일반 텍스트만 반환
 *   - 스트림 종료 후 parsedToolCalls 에서 구조화된 결과를 제공
 *
 * 매칭은 정규식 기반이라 `<function = name>`, `< function=name>` 같은 공백 변형도 흡수한다.
 */

import type { ToolCall } from './types.js'
import { makeLogger } from '../utils/logger.js'

const log = makeLogger('text_tool_call_filter.ts')

// 완전 매칭(open) — 두 패턴 중 가장 일찍 등장하는 위치를 마커 시작점으로 채택.
// OPEN_FUNCTION_RE 가 마지막에 \w 를 요구하는 이유: '<function=' 만 들어온 시점에는
// 다음 토큰에 함수명이 더 올 수 있으므로 confirm 하지 않고 partial 로 처리한다.
const OPEN_TOOL_CALL_RE = /<tool_call>/
const OPEN_FUNCTION_RE = /<\s*function\s*=\s*\w/

// 닫힘 태그(둘 중 어떤 포맷인지에 따라 분기). 공백 변형 허용.
const CLOSE_TOOL_CALL_RE = /<\s*\/\s*tool_call\s*>/
const CLOSE_FUNCTION_RE = /<\s*\/\s*function\s*>/

// 고아 닫힘 태그(시작 마커 없이 단독으로 등장하는 경우 그냥 제거)
const ORPHAN_CLOSE_RE = /<\s*\/\s*(?:tool_call|function)\s*>/g

// 부분 매칭 후보. 토큰 경계에서 마커가 잘릴 수 있으므로 prefix 집합으로 확인.
// 마커가 길어질 수 있는 모든 변형을 포함해야 한다.
const FULL_OPEN_MARKERS_FOR_PARTIAL = [
  '<tool_call>',
  '<function=', '<function =', '<function = ',
  '< function=', '< function =', '< function = ',
]
const OPEN_PARTIAL_PREFIXES: string[] = (() => {
  const set = new Set<string>()
  for (const m of FULL_OPEN_MARKERS_FOR_PARTIAL) {
    for (let i = 1; i < m.length; i++) set.add(m.slice(0, i))
  }
  // 긴 prefix 부터 검사해야 더 정확한 보류 길이를 얻을 수 있다.
  return Array.from(set).sort((a, b) => b.length - a.length)
})()

export class TextToolCallFilter {
  private pending = ''      // 도구 호출 시작일 수 있어서 보류 중인 텍스트
  private toolBuf = ''      // 도구 호출 블록 버퍼
  private inTool = false
  readonly parsedToolCalls: ToolCall[] = []

  /**
   * 토큰을 받아 UI에 표시할 안전한 텍스트만 반환합니다.
   * 도구 호출 구간의 토큰은 빈 문자열로 억제됩니다.
   */
  feed(token: string): string {
    if (this.inTool) {
      this.toolBuf += token
      return this.tryCloseAndContinue('')
    }

    this.pending += token

    // 도구 호출 시작 마커가 완전히 포함된 경우
    const openIdx = this.findOpen(this.pending)
    if (openIdx !== -1) {
      const safe = this.pending.slice(0, openIdx)
      this.toolBuf = this.pending.slice(openIdx)
      this.pending = ''
      this.inTool = true
      log.warn(`도구 호출 마커 감지: ${this.toolBuf.slice(0, 40)}`)
      // open + close 가 같은 토큰에 들어온 경우 즉시 닫고, 잔여 텍스트도 이어서 처리.
      return this.tryCloseAndContinue(safe)
    }

    // pending 끝부분이 마커의 부분 일치일 수 있으므로 보류 (전체가 prefix 인 경우 partialIdx=0 도 포함)
    const partialIdx = findPartialOpenEnd(this.pending)
    if (partialIdx >= 0) {
      const safe = this.pending.slice(0, partialIdx)
      this.pending = this.pending.slice(partialIdx)
      return safe
    }

    // 고아 닫힘 태그 제거
    if (ORPHAN_CLOSE_RE.test(this.pending)) {
      log.warn('고아 닫힘 태그 제거')
      this.pending = this.pending.replace(ORPHAN_CLOSE_RE, '')
    }

    const safe = this.pending
    this.pending = ''
    return safe
  }

  /**
   * inTool 상태에서 close 태그 검사 후 닫혔으면 잔여 텍스트를 일반 경로로 재귀 처리.
   * 닫히지 않았다면 prefix 만 반환하고 buffer 유지.
   */
  private tryCloseAndContinue(prefix: string): string {
    const closeIdx = this.findClose()
    if (closeIdx === -1) return prefix
    const toolText = this.toolBuf.slice(0, closeIdx)
    const after = this.toolBuf.slice(closeIdx)
    this.toolBuf = ''
    this.inTool = false
    const parsed = parseOneToolCall(toolText)
    if (parsed) this.parsedToolCalls.push(parsed)
    // 닫힘 태그 이후 내용은 다시 일반 처리
    return prefix + (after ? this.feed(after) : '')
  }

  /**
   * 스트림 종료 후 호출. 보류된 pending 텍스트를 반환합니다.
   * (도구 호출로 확인되지 않은 텍스트는 일반 텍스트로 처리)
   */
  flush(): string {
    if (this.inTool && this.toolBuf) {
      log.warn(`⚠ flush 시점에 미닫힌 도구 블록 존재 — 해당 구간 텍스트 드롭됨 (len=${this.toolBuf.length}, preview=${this.toolBuf.slice(0, 80)})`)
    }
    const leftover = this.inTool ? '' : this.pending
    this.pending = ''
    this.toolBuf = ''
    this.inTool = false
    return leftover
  }

  private findOpen(text: string): number {
    const m1 = OPEN_TOOL_CALL_RE.exec(text)
    const m2 = OPEN_FUNCTION_RE.exec(text)
    const i1 = m1 ? m1.index : -1
    const i2 = m2 ? m2.index : -1
    if (i1 === -1) return i2
    if (i2 === -1) return i1
    return Math.min(i1, i2)
  }

  private findClose(): number {
    if (this.toolBuf.startsWith('<tool_call>')) {
      const m = CLOSE_TOOL_CALL_RE.exec(this.toolBuf)
      return m ? m.index + m[0].length : -1
    }
    if (/^<\s*function\s*=/.test(this.toolBuf)) {
      const m = CLOSE_FUNCTION_RE.exec(this.toolBuf)
      return m ? m.index + m[0].length : -1
    }
    return -1
  }
}

/** pending 끝부분이 마커의 접두사와 일치하는 위치를 반환 */
function findPartialOpenEnd(text: string): number {
  for (const p of OPEN_PARTIAL_PREFIXES) {
    if (text.endsWith(p)) return text.length - p.length
  }
  return -1
}

/** 도구 호출 텍스트 한 블록을 ToolCall로 변환 */
function parseOneToolCall(text: string): ToolCall | null {
  try {
    // 포맷 1: <tool_call>{"name":"...","arguments":{...}}</tool_call>
    const jsonMatch = text.match(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/)
    if (jsonMatch) {
      const obj = JSON.parse(jsonMatch[1])
      if (obj?.name) {
        return {
          id: `call_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          function: { name: obj.name, arguments: obj.arguments ?? obj.parameters ?? {} }
        }
      }
    }

    // 포맷 2: <function=name><parameter=p>v</parameter>...</function> (공백 허용)
    const funcMatch = text.match(/<\s*function\s*=\s*(\w+)\s*>([\s\S]*?)(?:<\s*\/\s*function\s*>|$)/)
    if (funcMatch) {
      const name = funcMatch[1]
      const body = funcMatch[2]
      const args: Record<string, unknown> = {}
      const paramRe = /<\s*parameter\s*=\s*(\w+)\s*>([\s\S]*?)<\s*\/\s*parameter\s*>/g
      let m: RegExpExecArray | null
      while ((m = paramRe.exec(body)) !== null) {
        const val = m[2].trim()
        try { args[m[1]] = JSON.parse(val) } catch { args[m[1]] = val }
      }
      return {
        id: `call_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        function: { name, arguments: args }
      }
    }
  } catch {
    // 파싱 실패 시 무시
  }
  return null
}
