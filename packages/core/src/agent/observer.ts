/**
 * Environment Feedback (관찰 단계 강제 주입).
 *
 * LLM 이 "파일을 수정했다"고 응답할 때 그 결과를 그대로 믿는 것이 환각의 가장 흔한 원인이다.
 * 이 모듈은 도구 실행 직후 시스템 차원에서 *실제 환경의 상태*를 측정해 LLM 에 다시 주입한다.
 *
 * 책임:
 *   1. write_file / edit_file / edit_symbol 사용 시 파일이 실제로 존재·갱신됐는지 확인
 *   2. read_file / list_dir 결과가 비어있을 때 그 사실을 명확히 알림
 *   3. run_terminal 의 exit code 가 0 이 아니면 stderr 요지를 강조
 *   4. tool_result 가 __toolSkipped 또는 __preflight 인 경우 요약
 *
 * 결과는 [Observation] system 메시지로 messages 에 append 된다.
 * 모델은 다음 reasoning 단계에서 이 객관적 관찰을 보고 진행 방향을 보정한다.
 */

import { stat, readFile } from 'fs/promises'
import { join } from 'path'
import type { ToolCall, Message } from '../providers/types.js'
import type { HostAdapter } from '../host/interface.js'
import { makeLogger } from '../utils/logger.js'

const log = makeLogger('observer.ts')

const WRITE_TOOLS = new Set(['write_file', 'edit_file', 'edit_symbol'])
const READ_TOOLS = new Set(['read_file', 'list_dir', 'glob_tool', 'grep_tool', 'search_symbol'])

export interface ObservationInput {
  call: ToolCall
  /** dispatch 의 결과 객체 (보통 JSON 직렬화된 문자열로 messages 에 들어가 있음) */
  result: unknown
}

/**
 * 한 턴에서 사용된 모든 도구의 실제 결과를 *환경 측정* 기준으로 점검하고,
 * 모델에 주입할 단일 system message 를 생성한다 (없으면 null).
 */
export async function observeToolResults(
  observations: ObservationInput[],
  host: HostAdapter
): Promise<Message | null> {
  if (observations.length === 0) return null

  const lines: string[] = []

  for (const { call, result } of observations) {
    const toolName = call.function.name
    const parsed = parseResult(result)

    if (parsed?.__toolSkipped) {
      lines.push(`- ${toolName}: 시스템에 의해 차단됨 — 더 이상 호출하지 말 것.`)
      continue
    }
    if (parsed?.__preflight) {
      lines.push(`- ${toolName}: 인자 검증 실패 — 위 tool_result 의 'error' 를 읽고 인자를 고쳐 다시 호출하세요.`)
      continue
    }
    if (parsed?.__userRejected) {
      lines.push(`- ${toolName}: 사용자가 거부함 — 즉시 중단하고 사용자 의도를 다시 확인하세요.`)
      continue
    }

    if (WRITE_TOOLS.has(toolName)) {
      const obs = await observeWrite(call, parsed, host)
      if (obs) lines.push(obs)
    } else if (toolName === 'run_terminal') {
      const obs = observeTerminal(parsed)
      if (obs) lines.push(obs)
    } else if (READ_TOOLS.has(toolName)) {
      const obs = observeRead(toolName, parsed)
      if (obs) lines.push(obs)
    }
    // 그 외 도구는 별도 관찰 불필요 (결과가 그대로 신뢰 가능)
  }

  if (lines.length === 0) return null
  return {
    role: 'system',
    content: `[Observation — 환경 측정 결과]\n${lines.join('\n')}\n\n위 사실은 도구가 보고한 값이 아니라 시스템이 직접 확인한 것입니다. 다음 reasoning 에서 반드시 반영하세요.`,
  }
}

// ── 카테고리별 관찰자 ────────────────────────────────────────

async function observeWrite(
  call: ToolCall,
  parsed: ResultObject | null,
  host: HostAdapter
): Promise<string | null> {
  const toolName = call.function.name
  // 도구가 자체 에러를 보고했다면 그대로 강조
  if (parsed?.error) {
    return `- ${toolName}: 보고된 오류 → ${truncate(String(parsed.error), 200)}`
  }

  const path = (call.function.arguments as { path?: string; file_path?: string })?.path
    ?? (call.function.arguments as { file_path?: string })?.file_path
  if (!path || typeof path !== 'string') return null

  const absPath = join(host.getProjectRoot(), path)
  try {
    const stats = await stat(absPath)
    const sample = stats.isFile() ? await readFirstChars(absPath, 240) : ''
    const sizeKb = (stats.size / 1024).toFixed(1)
    return `- ${toolName}: 파일 '${path}' 존재 확인 (${sizeKb}KB, mtime=${stats.mtime.toISOString()}). 첫 줄 미리보기: ${truncate(sample.replace(/\n/g, '⏎'), 160)}`
  } catch {
    return `- ${toolName}: ⚠️ 파일 '${path}' 가 실제로는 존재하지 않습니다 — 도구 실행이 실패했거나 다른 경로에 쓰였을 수 있습니다. 조치를 재검토하세요.`
  }
}

function observeTerminal(parsed: ResultObject | null): string | null {
  if (!parsed) return null
  if (parsed.error) return `- run_terminal: ⚠️ 오류 → ${truncate(String(parsed.error), 240)}`
  const exitCode = parsed.exitCode ?? parsed.exit_code
  if (typeof exitCode === 'number' && exitCode !== 0) {
    const stderr = String(parsed.stderr ?? '').trim()
    return `- run_terminal: ⚠️ exit code = ${exitCode} (실패). stderr 요지: ${truncate(stderr, 240) || '(비어있음)'}`
  }
  return null
}

function observeRead(toolName: string, parsed: ResultObject | null): string | null {
  if (!parsed) return null
  if (parsed.error) return `- ${toolName}: 오류 → ${truncate(String(parsed.error), 200)}`
  // 결과가 비어있는 경우 명시
  const isEmpty =
    (Array.isArray(parsed.results) && parsed.results.length === 0) ||
    (Array.isArray(parsed.matches) && parsed.matches.length === 0) ||
    (Array.isArray(parsed.entries) && parsed.entries.length === 0) ||
    (typeof parsed.content === 'string' && parsed.content.length === 0)
  if (isEmpty) {
    return `- ${toolName}: 결과가 비어 있습니다. 패턴/경로를 다시 확인하거나 다른 도구로 전환하세요.`
  }
  return null
}

// ── 헬퍼 ─────────────────────────────────────────────────────

interface ResultObject {
  error?: unknown
  exitCode?: number
  exit_code?: number
  stderr?: unknown
  results?: unknown[]
  matches?: unknown[]
  entries?: unknown[]
  content?: string
  __toolSkipped?: boolean
  __preflight?: boolean
  __userRejected?: boolean
  [key: string]: unknown
}

function parseResult(raw: unknown): ResultObject | null {
  if (raw == null) return null
  if (typeof raw === 'object') return raw as ResultObject
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as ResultObject } catch { return null }
  }
  return null
}

async function readFirstChars(absPath: string, n: number): Promise<string> {
  try {
    const buf = await readFile(absPath, 'utf-8')
    return buf.slice(0, n)
  } catch (e) {
    log.debug('readFirstChars 실패:', (e as Error).message)
    return ''
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 3) + '...' : s
}
