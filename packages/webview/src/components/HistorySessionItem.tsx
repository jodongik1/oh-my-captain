import { useState } from 'react'
import type { SessionSummary } from '../store'

function formatDate(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const sessionDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  if (sessionDay === todayStart) {
    return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
  } else if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })
  } else {
    return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })
  }
}

interface HistorySessionItemProps {
  session: SessionSummary
  isActive: boolean
  onSelect: () => void
  onDelete: () => void
  onRename: (newTitle: string) => void
}

export default function HistorySessionItem({
  session, isActive, onSelect, onDelete, onRename
}: HistorySessionItemProps) {
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(session.title)

  const handleRenameSubmit = () => {
    if (editValue.trim()) onRename(editValue.trim())
    setEditing(false)
  }

  return (
    <div
      className={`history-item ${isActive ? 'active' : ''}`}
      onClick={() => { if (!editing) onSelect() }}
    >
      {editing ? (
        <input
          className="history-item-title-editing"
          value={editValue}
          autoFocus
          onChange={e => setEditValue(e.target.value)}
          onBlur={handleRenameSubmit}
          onKeyDown={e => {
            if (e.key === 'Enter') handleRenameSubmit()
            if (e.key === 'Escape') setEditing(false)
            e.stopPropagation()
          }}
          onClick={e => e.stopPropagation()}
        />
      ) : (
        <div className="history-item-info">
          <span className="history-item-title" title={session.title}>{session.title}</span>
          <span className="history-item-date">{formatDate(session.updatedAt)}</span>
        </div>
      )}
      <div className="history-item-actions">
        <button
          className="icon-btn"
          onClick={e => { e.stopPropagation(); setEditing(true); setEditValue(session.title) }}
          title="이름 변경"
          style={{ fontSize: 11, padding: '2px 4px' }}
        >
          ✎
        </button>
        <button
          className="icon-btn"
          onClick={e => { e.stopPropagation(); onDelete() }}
          title="삭제"
          style={{ fontSize: 11, padding: '2px 4px', color: 'var(--tool-error)' }}
        >
          🗑
        </button>
      </div>
    </div>
  )
}
