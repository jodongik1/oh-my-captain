import { useState } from 'react'
import { sendToHost } from '../../bridge/jcef'
import { ExternalLink } from 'lucide-react'

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
    if (t === 'write_to_file') return 'write'
    if (t === 'multi_replace_file_content' || t === 'replace_file_content') return 'edit'
    if (t === 'list_dir') return 'bash'
    if (t === 'agent') return 'agent'
    if (t === 'grep_search' || t === 'search') return 'search'
    return 'generic'
  }

  const getDisplayName = () => {
    switch (tool) {
      case 'read_file': return 'Read'
      case 'write_to_file': return 'Write'
      case 'multi_replace_file_content':
      case 'replace_file_content': return 'Edit'
      case 'list_dir': return 'List Dir'
      case 'agent': return 'Agent'
      case 'grep_search': return 'Search'
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

  // ── 컴팩트 모드: read_file, list_dir ──
  const isCompact = tool === 'read_file' || tool === 'list_dir'

  if (isCompact) {
    const label = tool === 'read_file'
      ? (isActive ? '읽는 중' : '읽음')
      : (isActive ? '목록 조회 중' : '목록 조회')
    
    const target = tool === 'read_file'
      ? getBasename()
      : getBasename() || ((args as any)?.DirectoryPath || (args as any)?.path || '')

    return (
      <div className={`tool-compact tool-${getToolClass()}`}>
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

  // ── IN Content rendering ──
  const renderInContent = () => {
    if (tool === 'replace_file_content' || tool === 'multi_replace_file_content') {
      return <span><strong>{getBasename()}</strong> 편집 중</span>
    } else if (tool === 'write_to_file') {
      return <span><strong>{getBasename()}</strong>에 쓰는 중</span>
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
    if (r.output) return <span>{r.output}</span>
    if (r.error) return <span className="error-text">{r.error}</span>
    return <span>{JSON.stringify(r)}</span>
  }

  const hasOutputContent = result && (typeof result === 'string' || (result as any).output || (result as any).error)

  return (
    <div className={`tool-block tool-${getToolClass()} ${result && (result as any).error ? 'failed' : ''}`}>
      <div className="tool-header" onClick={() => setExpanded(!expanded)}>
        <div className="tool-title">
          {getDisplayName()}
          {isActive && <span className="status-dots" />}
          {elapsedStr && <span className="tool-elapsed">{elapsedStr}</span>}
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
