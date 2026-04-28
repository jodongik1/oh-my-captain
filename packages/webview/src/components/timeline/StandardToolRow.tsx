// 일반 도구 행 — 헤더 / IN / OUT 영역, 결과 펼치기 지원.
// edit_file 의 diff, agent 의 task 설명, write/edit 의 파일명 등 도구별 인자/결과 차이는 본 컴포넌트가 담당.

import { useState } from 'react'
import { ExternalLink } from 'lucide-react'
import DiffView from './DiffView'
import type { ToolMeta } from '../../tools/registry'

interface Props {
  meta: ToolMeta
  args: unknown
  result?: unknown
  isActive?: boolean
  startedAt?: number
  onOpenPath: () => void
}

interface ToolResultObject {
  __toolSkipped?: boolean
  reason?: string
  diff?: string
  output?: string
  error?: string
}

function basenameOf(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

function pickString(args: unknown, key: string): string | null {
  if (!args || typeof args !== 'object') return null
  const v = (args as Record<string, unknown>)[key]
  return typeof v === 'string' ? v : null
}

function buildHeaderDetails(meta: ToolMeta, args: unknown): string {
  if (meta.id === 'agent') {
    return pickString(args, 'task') ?? pickString(args, 'TaskName') ?? pickString(args, 'prompt') ?? 'Sub-agent task'
  }
  if (!args || typeof args !== 'object') return ''
  const a = args as Record<string, unknown>
  const parts: string[] = []
  if (a.StartLine || a.EndLine) {
    parts.push(`Lines ${a.StartLine ?? '*'} - ${a.EndLine ?? '*'}`)
  }
  if (parts.length > 0) return parts.join(', ')
  const path = meta.extractPath?.(args)
  return path ? basenameOf(path) : ''
}

function renderInContent(meta: ToolMeta, args: unknown) {
  const path = meta.extractPath?.(args) ?? null
  const file = path ? basenameOf(path) : ''
  if (meta.id === 'edit_file') return <span>Editing <strong>{file}</strong></span>
  if (meta.id === 'write_file') return <span>Writing to <strong>{file}</strong></span>
  if (meta.id === 'agent') {
    const task = pickString(args, 'task') ?? pickString(args, 'TaskName') ?? pickString(args, 'prompt') ?? 'Sub-agent task'
    return <span>{task}</span>
  }
  return <span>{file || JSON.stringify(args)}</span>
}

function renderOutContent(result: unknown) {
  if (result == null) return null
  if (typeof result === 'string') return <span>{result}</span>
  const r = result as ToolResultObject
  if (r.__toolSkipped) {
    return <span className="tap-to-expand">건너뜀 — {r.reason ?? '도구가 너무 많이 호출되어 차단되었습니다.'}</span>
  }
  if (r.diff) return <DiffView diff={r.diff} defaultExpanded={true} />
  if (r.output) return <span>{r.output}</span>
  if (r.error) return <span className="error-text">{r.error}</span>
  return <span>{JSON.stringify(r)}</span>
}

export default function StandardToolRow({ meta, args, result, isActive, startedAt, onOpenPath }: Props) {
  const [expanded, setExpanded] = useState(false)

  const elapsed = startedAt ? Math.round((Date.now() - startedAt) / 1000) : 0
  const elapsedStr = !isActive && elapsed > 0 ? ` (${elapsed}s)` : ''

  const r = (result && typeof result === 'object' ? (result as ToolResultObject) : undefined)
  const isSkipped = !!r?.__toolSkipped
  const failed = !!(r?.error && !isSkipped)
  const hasOutput = !!result && (typeof result === 'string' || !!r?.output || !!r?.error || !!r?.diff || isSkipped)

  const path = meta.extractPath?.(args) ?? null
  const headerDetails = buildHeaderDetails(meta, args)

  return (
    <div className={`tool-block tool-${meta.cssClass} ${failed ? 'failed' : ''} ${isSkipped ? 'skipped' : ''}`}>
      <div className="tool-header" onClick={() => setExpanded(v => !v)}>
        <div className="tool-title">
          {meta.displayName}
          {isActive && <span className="status-dots" />}
          {!!elapsedStr && <span className="tool-elapsed">{elapsedStr}</span>}
        </div>
        <div
          className="tool-resource-link"
          onClick={(e) => { e.stopPropagation(); onOpenPath() }}
          title={path ? '클릭하여 에디터에서 열기' : ''}
        >
          {headerDetails}
          {path && <ExternalLink size={10} style={{ marginLeft: '4px', display: 'inline-block' }} />}
        </div>
      </div>
      <div className="tool-body">
        <div className="in-out-row">
          <div className="in-out-label">IN</div>
          <div className="in-out-content">{renderInContent(meta, args)}</div>
        </div>
        {hasOutput && (
          <div className="in-out-row out-row" onClick={() => !expanded && setExpanded(true)}>
            <div className="in-out-label">OUT</div>
            <div className={`in-out-content output-text ${expanded ? 'expanded' : 'collapsed'}`}>
              {expanded
                ? renderOutContent(result)
                : <span className="tap-to-expand">출력이 접혀 있습니다. 클릭하여 펼치세요.</span>}
            </div>
          </div>
        )}
        {isActive && !hasOutput && (
          <div className="in-out-row">
            <div className="in-out-label">OUT</div>
            <div className="in-out-content">
              <span className="status-label active">처리 중<span className="status-dots" /></span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
