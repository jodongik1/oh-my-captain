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
 */

import type { OllamaToolCall } from './types.js'
import { logger } from '../utils/logger.js'

// 도구 호출이 시작될 수 있는 마커 (공백 포함 변형도 지원)
const OPEN_MARKERS = ['<tool_call>', '<function=', '< function=', '<function =']

// 도구 호출 잔여 닫힘 태그 (마커 없이 단독으로 나타나는 경우 필터링)
const CLOSE_ONLY_TAGS = ['</tool_call>', '</function>']

export class TextToolCallFilter {
  private pending = ''      // 도구 호출 시작일 수 있어서 보류 중인 텍스트
  private toolBuf = ''      // 도구 호출 블록 버퍼
  private inTool = false
  readonly parsedToolCalls: OllamaToolCall[] = []

  /**
   * 토큰을 받아 UI에 표시할 안전한 텍스트만 반환합니다.
   * 도구 호출 구간의 토큰은 빈 문자열로 억제됩니다.
   */
  feed(token: string): string {
    if (this.inTool) {
      this.toolBuf += token
      const closeIdx = this.findClose()
      if (closeIdx !== -1) {
        const toolText = this.toolBuf.slice(0, closeIdx)
        const after = this.toolBuf.slice(closeIdx)
        this.toolBuf = ''
        this.inTool = false
        const parsed = parseOneToolCall(toolText)
        if (parsed) this.parsedToolCalls.push(parsed)
        // 닫힘 태그 이후 내용은 다시 일반 처리
        return this.feed(after)
      }
      return ''
    }

    this.pending += token

    // 도구 호출 시작 마커가 완전히 포함된 경우
    const openIdx = this.findOpen(this.pending)
    if (openIdx !== -1) {
      const safe = this.pending.slice(0, openIdx)
      this.toolBuf = this.pending.slice(openIdx)
      this.pending = ''
      this.inTool = true
      logger.warn({ trigger: this.toolBuf.slice(0, 40) }, '[TextToolCallFilter] 도구 호출 마커 감지')
      return safe
    }

    // pending 끝부분이 마커의 부분 일치일 수 있으므로 보류
    const partialIdx = findPartialOpenEnd(this.pending)
    if (partialIdx > 0) {
      const safe = this.pending.slice(0, partialIdx)
      this.pending = this.pending.slice(partialIdx)
      return safe
    }

    // 고아 닫힘 태그(</tool_call>, </function>) 제거
    for (const tag of CLOSE_ONLY_TAGS) {
      if (this.pending.includes(tag)) {
        logger.warn({ tag }, '[TextToolCallFilter] 고아 닫힘 태그 제거')
        this.pending = this.pending.split(tag).join('')
      }
    }

    const safe = this.pending
    this.pending = ''
    return safe
  }

  /**
   * 스트림 종료 후 호출. 보류된 pending 텍스트를 반환합니다.
   * (도구 호출로 확인되지 않은 텍스트는 일반 텍스트로 처리)
   */
  flush(): string {
    if (this.inTool && this.toolBuf) {
      logger.warn({ toolBufLength: this.toolBuf.length, toolBufPreview: this.toolBuf.slice(0, 80) }, '[TextToolCallFilter] ⚠ flush 시점에 미닫힌 도구 블록 존재 — 해당 구간 텍스트 드롭됨 (오탐 가능성)')
    }
    const leftover = this.inTool ? '' : this.pending
    this.pending = ''
    this.toolBuf = ''
    this.inTool = false
    return leftover
  }

  private findOpen(text: string): number {
    let earliest = -1
    for (const marker of OPEN_MARKERS) {
      const idx = text.indexOf(marker)
      if (idx !== -1 && (earliest === -1 || idx < earliest)) earliest = idx
    }
    return earliest
  }

  private findClose(): number {
    if (this.toolBuf.startsWith('<tool_call>')) {
      const idx = this.toolBuf.indexOf('</tool_call>')
      return idx === -1 ? -1 : idx + '</tool_call>'.length
    }
    if (/^<function=/.test(this.toolBuf)) {
      const idx = this.toolBuf.indexOf('</function>')
      return idx === -1 ? -1 : idx + '</function>'.length
    }
    return -1
  }
}

/** pending 끝부분이 마커의 접두사와 일치하는 위치를 반환 */
function findPartialOpenEnd(text: string): number {
  for (const marker of OPEN_MARKERS) {
    for (let len = Math.min(marker.length - 1, text.length); len > 0; len--) {
      if (text.endsWith(marker.slice(0, len))) {
        return text.length - len
      }
    }
  }
  return -1
}

/** 도구 호출 텍스트 한 블록을 OllamaToolCall로 변환 */
function parseOneToolCall(text: string): OllamaToolCall | null {
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

    // 포맷 2: <function=name><parameter=p>v</parameter>...</function>
    const funcMatch = text.match(/<function=(\w+)>([\s\S]*?)(?:<\/function>|$)/)
    if (funcMatch) {
      const name = funcMatch[1]
      const body = funcMatch[2]
      const args: Record<string, unknown> = {}
      const paramRe = /<parameter=(\w+)>([\s\S]*?)<\/parameter>/g
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
