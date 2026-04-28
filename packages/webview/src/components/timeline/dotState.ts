// Timeline entry → dot 색상 결정 로직.
// Timeline.tsx 의 인라인 분기를 빼와 유닛 단위로 단순화.
import type { TimelineEntry } from '../../store'

export type DotClass = 'dot-active' | 'dot-success' | 'dot-error' | 'dot-warn' | 'dot-inactive'

export interface DotState {
  show: boolean
  className: DotClass
}

export function computeDot(entry: TimelineEntry): DotState {
  // 사용자 abort 로 중단된 entry 는 회색으로 통일 (다른 결정을 덮어씀)
  if (entry.interrupted) return { show: true, className: 'dot-inactive' }
  if (entry.type === 'user') return { show: false, className: 'dot-inactive' }

  switch (entry.type) {
    case 'tool_start':
      return { show: true, className: classifyTool(entry) }
    case 'thinking':
      return { show: true, className: entry.isActive ? 'dot-active' : 'dot-inactive' }
    case 'verify':
      if (entry.isActive) return { show: true, className: 'dot-active' }
      if (entry.verify?.passed) return { show: true, className: 'dot-success' }
      // 환경 에러는 빨강 대신 노랑 — 사용자에게 "코드 문제 아님" 시그널
      return { show: true, className: entry.verify?.failureKind === 'env' ? 'dot-warn' : 'dot-error' }
    case 'stream':
      return { show: true, className: entry.isStreaming ? 'dot-active' : 'dot-inactive' }
    case 'error':
      return { show: true, className: 'dot-error' }
    case 'approval':
      if (entry.isActive) return { show: true, className: 'dot-active' }
      return { show: true, className: entry.approval?.approved ? 'dot-success' : 'dot-error' }
    case 'interrupted':
    case 'tool_result':
    default:
      return { show: true, className: 'dot-inactive' }
  }
}

function classifyTool(entry: Extract<TimelineEntry, { type: 'tool_start' }>): DotClass {
  if (entry.isActive) return 'dot-active'
  const r = entry.result as { __toolSkipped?: boolean; error?: unknown; exitCode?: number } | undefined
  if (r?.__toolSkipped) return 'dot-inactive'
  if (entry.tool === 'run_terminal') {
    return r && (r.exitCode !== 0 || r.error) ? 'dot-error' : 'dot-success'
  }
  if (r?.error) return 'dot-error'
  return 'dot-success'
}
