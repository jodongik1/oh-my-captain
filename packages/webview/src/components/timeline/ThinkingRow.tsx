import { useState } from 'react'

interface ThinkingRowProps {
  durationMs: number
  content?: string
  isActive?: boolean
}

export default function ThinkingRow({ durationMs, content, isActive }: ThinkingRowProps) {
  const [expanded, setExpanded] = useState(false)
  const seconds = Math.round(durationMs / 1000)

  return (
    <div className="thinking-block">
      <div
        className={`thinking-header ${isActive ? 'thinking-active' : ''}`}
        onClick={() => !isActive && setExpanded(!expanded)}
      >
        {isActive ? (
          <span className="thinking-label active">
            Thinking<span className="status-dots" />
          </span>
        ) : (
          <>
            <span className="thinking-label">Thought for {seconds}s</span>
            <span className="thinking-toggle">{expanded ? '▾' : '>'}</span>
          </>
        )}
      </div>
      {expanded && content && (
        <div className="thinking-content">{content}</div>
      )}
    </div>
  )
}
