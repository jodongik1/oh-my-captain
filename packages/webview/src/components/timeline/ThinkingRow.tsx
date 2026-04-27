import { useState } from 'react'

interface ThinkingRowProps {
  durationMs: number
  content?: string
  isActive?: boolean
}

export default function ThinkingRow({ durationMs, content, isActive }: ThinkingRowProps) {
  const [expanded, setExpanded] = useState(false)
  const seconds = Math.round(durationMs / 1000)

  // 완료된 thinking 중 1초 미만짜리는 표시하지 않음 (store 의 DROP_LAST_THINKING 안전망)
  if (!isActive && seconds < 1) return null

  return (
    <div className="thinking-block">
      <div
        className={`thinking-header ${isActive ? 'thinking-active' : ''}`}
        onClick={() => !isActive && setExpanded(!expanded)}
      >
        {isActive ? (
          <span className="thinking-label active">
            생각 중<span className="status-dots" />
          </span>
        ) : (
          <>
            <span className="thinking-label">{seconds}초 동안 생각함</span>
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
