import { useState } from 'react'
import { sendToHost } from '../../bridge/jcef'
import { ExternalLink } from 'lucide-react'
import DiffView from './DiffView'

interface ToolRowProps {
  tool: string
  args: unknown
  result?: unknown
  isActive?: boolean
  startedAt?: number
}

export default function ToolRow({ tool, args, result, isActive, startedAt }: ToolRowProps) {
  const [expanded, setExpanded] = useState(false)

  const getToolClass = () => {
    const t = tool.toLowerCase()
    if (t === 'read_file') return 'read'
    if (t === 'write_file') return 'write'
    if (t === 'edit_file' || t === 'edit_symbol') return 'edit'
    if (t === 'list_dir') return 'bash'
    if (t === 'agent') return 'agent'
    if (t === 'grep_tool' || t === 'glob_tool' || t === 'search_symbol' || t === 'search') return 'search'
    if (t === 'fetch_url') return 'read'
    if (t === 'save_memory' || t === 'read_memory') return 'agent'
    return 'generic'
  }

  const getDisplayName = () => {
    switch (tool) {
      case 'read_file': return 'Read'
      case 'write_file': return 'Write'
      case 'edit_file': return 'Edit'
      case 'edit_symbol': return 'Edit Symbol'
      case 'list_dir': return 'List'
      case 'agent': return 'Agent'
      case 'grep_tool': return 'Grep'
      case 'glob_tool': return 'Glob'
      case 'search_symbol': return 'Search Symbol'
      case 'fetch_url': return 'Fetch'
      case 'save_memory': return 'Save Memory'
      case 'read_memory': return 'Read Memory'
      default: return tool
    }
  }

  const getResource = () => {
    const a = args as Record<string, unknown>
    if (a?.path) return a.path as string
    if (a?.AbsolutePath) return a.AbsolutePath as string
    if (a?.TargetFile) return a.TargetFile as string
    if (a?.DirectoryPath) return a.DirectoryPath as string
    return ''
  }
  
  const getBasename = () => {
    const res = getResource()
    if (!res) return ''
    const parts = res.split('/')
    return parts[parts.length - 1]
  }

  const getLine = () => {
    const a = args as Record<string, unknown>
    return a?.StartLine ? (a.StartLine as number) : undefined
  }

  const getDetails = () => {
    if (tool === 'agent') {
      const a = args as Record<string, unknown>
      return (a?.task || a?.TaskName || a?.prompt || 'Sub-agent task') as string
    }

    const a = args as Record<string, unknown>
    const parts = []
    if (a?.StartLine || a?.EndLine) {
      parts.push(`Lines ${a.StartLine || '*'} - ${a.EndLine || '*'}`)
    }
    return parts.join(', ') || getBasename()
  }

  const handleClick = () => {
    const path = getResource()
    if (path) {
      sendToHost({ type: 'open_in_editor', payload: { path, line: getLine() } })
    }
  }

  const elapsed = startedAt ? Math.round((Date.now() - startedAt) / 1000) : 0
  const elapsedStr = !isActive && elapsed > 0 ? ` (${elapsed}s)` : ''

  // ── 컴팩트 모드: read_file (한 줄) ──
  const isCompactRead = tool === 'read_file'

  if (isCompactRead) {
    const r = result as Record<string, any> | undefined
    const wasSkipped = !!(r && r.__toolSkipped)
    const label = wasSkipped ? 'Skipped' : isActive ? 'Reading' : 'Read'
    const target = getBasename()

    return (
      <div className={`tool-compact tool-${getToolClass()} ${wasSkipped ? 'skipped' : ''}`}>
        <span className="tool-compact-title">{label} </span>
        <span
          className="tool-compact-file"
          onClick={handleClick}
          title={getResource() ? '클릭하여 에디터에서 열기' : ''}
        >
          {target}
        </span>
        {isActive && <span className="status-dots" />}
      </div>
    )
  }

  // ── list_dir / glob_tool: 결과 트리/파일 목록 미리보기 ──
  if (tool === 'list_dir' || tool === 'glob_tool') {
    return (
      <ListingRow
        tool={tool}
        args={args}
        result={result}
        isActive={isActive}
        onOpen={handleClick}
        toolClass={getToolClass()}
        displayName={getDisplayName()}
        elapsedStr={elapsedStr}
      />
    )
  }

  // ── IN Content rendering ──
  const renderInContent = () => {
    if (tool === 'edit_file') {
      return <span>Editing <strong>{getBasename()}</strong></span>
    } else if (tool === 'write_file') {
      return <span>Writing to <strong>{getBasename()}</strong></span>
    } else if (tool === 'agent') {
      const a = args as Record<string, unknown>
      return <span>{(a?.task || a?.TaskName || a?.prompt || 'Sub-agent task') as string}</span>
    }
    return <span>{getBasename() || JSON.stringify(args)}</span>
  }

  const renderOutContent = () => {
    const r = result as string | Record<string, any>
    if (!r) return null
    if (typeof r === 'string') return <span>{r}</span>

    // 차단된 도구 — 친화적 안내
    if (r.__toolSkipped) {
      return <span className="tap-to-expand">건너뜀 — {r.reason ?? '도구가 너무 많이 호출되어 차단되었습니다.'}</span>
    }

    // diff 렌더링 (edit_file 결과)
    if (r.diff) return <DiffView diff={r.diff} defaultExpanded={true} />

    if (r.output) return <span>{r.output}</span>
    if (r.error) return <span className="error-text">{r.error}</span>
    return <span>{JSON.stringify(r)}</span>
  }

  const isSkipped = !!(result && (result as any).__toolSkipped)
  const hasOutputContent = result && (typeof result === 'string' || (result as any).output || (result as any).error || (result as any).diff || isSkipped)

  return (
    <div className={`tool-block tool-${getToolClass()} ${result && (result as any).error && !isSkipped ? 'failed' : ''} ${isSkipped ? 'skipped' : ''}`}>
      <div className="tool-header" onClick={() => setExpanded(!expanded)}>
        <div className="tool-title">
          {getDisplayName()}
          {isActive && <span className="status-dots" />}
          {!!elapsedStr && <span className="tool-elapsed">{elapsedStr}</span>}
        </div>
        <div 
          className="tool-resource-link" 
          onClick={(e) => {
             e.stopPropagation()
             handleClick()
          }}
          title={getResource() ? "클릭하여 에디터에서 열기" : ""}
        >
          {getDetails()}
          {getResource() && <ExternalLink size={10} style={{ marginLeft: '4px', display: 'inline-block' }} />}
        </div>
      </div>
      <div className="tool-body">
        <div className="in-out-row">
          <div className="in-out-label">IN</div>
          <div className="in-out-content">
            {renderInContent()}
          </div>
        </div>
        {hasOutputContent && (
          <div className="in-out-row out-row" onClick={() => !expanded && setExpanded(true)}>
            <div className="in-out-label">OUT</div>
            <div className={`in-out-content output-text ${!expanded ? 'collapsed' : 'expanded'}`}>
              {!expanded ? (
                <span className="tap-to-expand">출력이 접혀 있습니다. 클릭하여 펼치세요.</span>
              ) : (
                renderOutContent()
              )}
            </div>
          </div>
        )}
        {isActive && !hasOutputContent && (
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

// ─────────────────────────────────────────────────────────────────────
// ListingRow: list_dir / glob_tool 결과를 트리/파일 목록 미리보기로 표시.
// 컴팩트 한 줄이 아닌, 상위 N개 항목 + "+M more" 클릭 펼침 형태.
// ─────────────────────────────────────────────────────────────────────

interface ListingRowProps {
  tool: string
  args: unknown
  result: unknown
  isActive?: boolean
  onOpen: () => void
  toolClass: string
  displayName: string
  elapsedStr: string
}

const PREVIEW_LIMIT = 8

interface FlatEntry {
  label: string
  type: 'directory' | 'file'
  size?: number
}

function flattenListDir(entries: any[], depth = 0): FlatEntry[] {
  const out: FlatEntry[] = []
  for (const e of entries ?? []) {
    const indent = '  '.repeat(depth)
    out.push({
      label: indent + (e.type === 'directory' ? `${e.name}/` : e.name),
      type: e.type,
      size: e.size,
    })
    if (e.children && Array.isArray(e.children)) {
      out.push(...flattenListDir(e.children, depth + 1))
    }
  }
  return out
}

function ListingRow({ tool, args, result, isActive, onOpen, toolClass, displayName, elapsedStr }: ListingRowProps) {
  const [expanded, setExpanded] = useState(false)
  const a = args as Record<string, unknown>
  const r = result as Record<string, any> | undefined

  // 헤더 메타: 검색 대상 표기
  const target = tool === 'list_dir'
    ? (a?.path as string) || '.'
    : (a?.pattern as string) || ''
  const cwd = tool === 'glob_tool' ? ((a?.cwd as string) || '') : ''

  // 결과 평탄화
  let items: FlatEntry[] = []
  let total = 0
  let truncated = false
  if (r) {
    if (tool === 'list_dir' && r.entries) {
      items = flattenListDir(r.entries)
      total = (r.totalEntries as number) ?? items.length
    } else if (tool === 'glob_tool' && Array.isArray(r.files)) {
      items = (r.files as string[]).map(f => ({ label: f, type: 'file' as const }))
      total = (r.totalFound as number) ?? items.length
      truncated = !!r.truncated
    }
  }

  const visible = expanded ? items : items.slice(0, PREVIEW_LIMIT)
  const remaining = items.length - visible.length

  const wasSkipped = !!(r && (r as any).__toolSkipped)
  const failed = r && (r as any).error && !wasSkipped

  return (
    <div className={`tool-block tool-${toolClass} ${failed ? 'failed' : ''} ${wasSkipped ? 'skipped' : ''}`}>
      <div className="tool-header" onClick={() => setExpanded(v => !v)}>
        <div className="tool-title">
          {displayName}
          {isActive && <span className="status-dots" />}
          {!!elapsedStr && <span className="tool-elapsed">{elapsedStr}</span>}
        </div>
        <div
          className="tool-resource-link"
          onClick={(e) => { e.stopPropagation(); onOpen() }}
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
              <span className="tap-to-expand">건너뜀 — {(r as any).reason ?? '도구가 너무 많이 호출되어 차단되었습니다.'}</span>
            </div>
          </div>
        )}
        {failed && (
          <div className="in-out-row out-row">
            <div className="in-out-label">OUT</div>
            <div className="in-out-content output-text expanded">
              <span className="error-text">{(r as any).error}</span>
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
