import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

interface DiffViewProps {
  diff: string
  defaultExpanded?: boolean
}

export default function DiffView({ diff, defaultExpanded = false }: DiffViewProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const lines = diff.split('\n')

  // 변경 통계 계산
  const additions = lines.filter(l => l.startsWith('+') && !l.startsWith('+++')).length
  const deletions = lines.filter(l => l.startsWith('-') && !l.startsWith('---')).length

  return (
    <div className="diff-view">
      <div className="diff-header" onClick={() => setExpanded(!expanded)}>
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="diff-stats">
          {additions > 0 && <span className="diff-stat-add">+{additions}</span>}
          {deletions > 0 && <span className="diff-stat-del">-{deletions}</span>}
        </span>
        <span className="diff-toggle-label">
          {expanded ? 'Hide diff' : 'Show diff'}
        </span>
      </div>
      {expanded && (
        <pre className="diff-content">
          {lines.map((line, i) => {
            let cls = 'diff-line-context'
            if (line.startsWith('+')) cls = 'diff-line-add'
            else if (line.startsWith('-')) cls = 'diff-line-del'
            else if (line.startsWith('@@')) cls = 'diff-line-hunk'
            return (
              <div key={i} className={`diff-line ${cls}`}>
                {line}
              </div>
            )
          })}
        </pre>
      )}
    </div>
  )
}
