/**
 * StatusLabel — 에이전트 상태 메시지 표시 컴포넌트
 * 도구 실행 중: "Reading settings.gradle..."
 * 도구 완료 후: "Read settings.gradle"
 */

interface StatusLabelProps {
  tool?: string
  args?: unknown
  isActive?: boolean
  startedAt?: number
}

export default function StatusLabel({ tool, args, isActive, startedAt }: StatusLabelProps) {
  const a = (args ?? {}) as Record<string, unknown>

  const getBasename = (path?: string) => {
    if (!path) return ''
    const parts = (path as string).split('/')
    return parts[parts.length - 1]
  }

  const getFilePath = () => {
    return (a?.path || a?.AbsolutePath || a?.TargetFile || a?.DirectoryPath || '') as string
  }

  const elapsed = startedAt ? Math.round((Date.now() - startedAt) / 1000) : 0
  const elapsedStr = elapsed > 0 ? ` (${elapsed}s)` : ''

  if (!tool) return null

  const file = getBasename(getFilePath())
  const t = tool.toLowerCase()

  if (isActive) {
    // 진행 중 상태 메시지
    if (t === 'read_file') return <span className="status-label active">Reading {file}<span className="status-dots" /></span>
    if (t === 'write_to_file') return <span className="status-label active">Writing {file}<span className="status-dots" /></span>
    if (t === 'replace_file_content' || t === 'multi_replace_file_content') return <span className="status-label active">Editing {file}<span className="status-dots" /></span>
    if (t === 'run_terminal') return <span className="status-label active">Running command<span className="status-dots" /></span>
    if (t === 'list_dir') return <span className="status-label active">Listing directory<span className="status-dots" /></span>
    if (t === 'agent') return <span className="status-label active">Running sub-agent<span className="status-dots" /></span>
    if (t === 'grep_search' || t === 'search') return <span className="status-label active">Searching<span className="status-dots" /></span>
    return <span className="status-label active">{tool}<span className="status-dots" /></span>
  }

  // 완료 상태 메시지
  if (t === 'read_file') return <span className="status-label">Read {file}{elapsedStr}</span>
  if (t === 'write_to_file') return <span className="status-label">Wrote {file}{elapsedStr}</span>
  if (t === 'replace_file_content' || t === 'multi_replace_file_content') return <span className="status-label">Edited {file}{elapsedStr}</span>
  if (t === 'run_terminal') return <span className="status-label">Bash{elapsedStr}</span>
  if (t === 'list_dir') return <span className="status-label">Listed directory{elapsedStr}</span>
  if (t === 'agent') return <span className="status-label">Agent completed{elapsedStr}</span>
  if (t === 'grep_search' || t === 'search') return <span className="status-label">Search completed{elapsedStr}</span>
  return <span className="status-label">{tool}{elapsedStr}</span>
}
