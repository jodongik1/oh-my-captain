// list_dir / glob_tool 결과를 트리/파일 목록 미리보기로 표시.
// 컴팩트가 아닌 헤더 + OUT 영역 + "+M more" 펼치기 형태.

import { useState } from 'react'
import type { ToolMeta } from '../../tools/registry'

interface Props {
  meta: ToolMeta
  args: unknown
  result?: unknown
  isActive?: boolean
  startedAt?: number
  onOpenPath: () => void
}

const PREVIEW_LIMIT = 8

interface FlatEntry {
  label: string
  type: 'directory' | 'file'
  size?: number
}

interface ListDirEntry {
  name: string
  type: 'directory' | 'file'
  size?: number
  children?: ListDirEntry[]
}

function flattenListDir(entries: ListDirEntry[] | undefined, depth = 0): FlatEntry[] {
  const out: FlatEntry[] = []
  for (const e of entries ?? []) {
    const indent = '  '.repeat(depth)
    out.push({
      label: indent + (e.type === 'directory' ? `${e.name}/` : e.name),
      type: e.type,
      size: e.size,
    })
    if (e.children) out.push(...flattenListDir(e.children, depth + 1))
  }
  return out
}

interface ListingResult {
  entries?: ListDirEntry[]
  totalEntries?: number
  files?: string[]
  totalFound?: number
  truncated?: boolean
  error?: string
  __toolSkipped?: boolean
  reason?: string
}

function pickString(args: unknown, key: string): string | undefined {
  if (!args || typeof args !== 'object') return undefined
  const v = (args as Record<string, unknown>)[key]
  return typeof v === 'string' ? v : undefined
}

export default function ListingRow({ meta, args, result, isActive, startedAt, onOpenPath }: Props) {
  const [expanded, setExpanded] = useState(false)
  const r = (result && typeof result === 'object') ? (result as ListingResult) : undefined

  const target = meta.id === 'list_dir'
    ? (pickString(args, 'path') ?? '.')
    : (pickString(args, 'pattern') ?? '')
  const cwd = meta.id === 'glob_tool' ? pickString(args, 'cwd') : undefined

  const elapsed = startedAt ? Math.round((Date.now() - startedAt) / 1000) : 0
  const elapsedStr = !isActive && elapsed > 0 ? ` (${elapsed}s)` : ''

  let items: FlatEntry[] = []
  let total = 0
  let truncated = false
  if (r) {
    if (meta.id === 'list_dir' && r.entries) {
      items = flattenListDir(r.entries)
      total = r.totalEntries ?? items.length
    } else if (meta.id === 'glob_tool' && Array.isArray(r.files)) {
      items = r.files.map(f => ({ label: f, type: 'file' as const }))
      total = r.totalFound ?? items.length
      truncated = !!r.truncated
    }
  }

  const visible = expanded ? items : items.slice(0, PREVIEW_LIMIT)
  const remaining = items.length - visible.length

  const wasSkipped = !!r?.__toolSkipped
  const failed = !!(r?.error && !wasSkipped)

  return (
    <div className={`tool-block tool-${meta.cssClass} ${failed ? 'failed' : ''} ${wasSkipped ? 'skipped' : ''}`}>
      <div className="tool-header" onClick={() => setExpanded(v => !v)}>
        <div className="tool-title">
          {meta.displayName}
          {isActive && <span className="status-dots" />}
          {!!elapsedStr && <span className="tool-elapsed">{elapsedStr}</span>}
        </div>
        <div
          className="tool-resource-link"
          onClick={(e) => { e.stopPropagation(); onOpenPath() }}
          title={target}
        >
          {target}
          {cwd && <span className="tool-elapsed"> · {cwd}</span>}
        </div>
      </div>
      <div className="tool-body">
        {wasSkipped && (
          <div className="in-out-row out-row">
            <div className="in-out-label">OUT</div>
            <div className="in-out-content output-text expanded">
              <span className="tap-to-expand">건너뜀 — {r?.reason ?? '도구가 너무 많이 호출되어 차단되었습니다.'}</span>
            </div>
          </div>
        )}
        {failed && (
          <div className="in-out-row out-row">
            <div className="in-out-label">OUT</div>
            <div className="in-out-content output-text expanded">
              <span className="error-text">{r?.error}</span>
            </div>
          </div>
        )}
        {!failed && !wasSkipped && r && items.length === 0 && (
          <div className="in-out-row out-row">
            <div className="in-out-label">OUT</div>
            <div className="in-out-content output-text expanded">
              <span className="tap-to-expand">결과 없음</span>
            </div>
          </div>
        )}
        {!failed && !wasSkipped && items.length > 0 && (
          <div className="in-out-row out-row">
            <div className="in-out-label">
              OUT
              <span className="line-count">{total}</span>
            </div>
            <div className="in-out-content output-text expanded">
              <pre className="listing-preview">{visible.map(v => v.label).join('\n')}</pre>
              {remaining > 0 && (
                <span
                  className="tap-to-expand"
                  onClick={(e) => { e.stopPropagation(); setExpanded(true) }}
                >
                  + {remaining} more (클릭하여 펼치기)
                </span>
              )}
              {expanded && truncated && (
                <span className="tap-to-expand">결과가 maxResults 로 잘렸습니다.</span>
              )}
            </div>
          </div>
        )}
        {isActive && !r && (
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
