import { useState, useRef, useEffect } from 'react'
import { Clock, PlusCircle, Pencil } from 'lucide-react'

interface HeaderBarProps {
  sessionTitle: string
  onHistoryToggle: () => void
  onNewSession: () => void
  onTitleChange: (title: string) => void
  isBusy: boolean
}

export default function HeaderBar({
  sessionTitle, onHistoryToggle, onNewSession, onTitleChange, isBusy
}: HeaderBarProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(sessionTitle)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  useEffect(() => {
    setEditValue(sessionTitle)
  }, [sessionTitle])

  const handleStartEdit = () => {
    setEditValue(sessionTitle)
    setIsEditing(true)
  }

  const handleFinishEdit = () => {
    setIsEditing(false)
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== sessionTitle) {
      onTitleChange(trimmed)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleFinishEdit()
    if (e.key === 'Escape') setIsEditing(false)
  }

  return (
    <div className="header-bar">
      <div className="header-title-area">
        {isEditing ? (
          <input
            ref={inputRef}
            className="header-title-input"
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onBlur={handleFinishEdit}
            onKeyDown={handleKeyDown}
          />
        ) : (
          <>
            <span className="header-title" title={sessionTitle}>
              {isBusy && <span className="busy-indicator" />}
              {sessionTitle}
            </span>
            <button className="header-edit-btn" onClick={handleStartEdit} title="Rename">
              <Pencil size={12} />
            </button>
          </>
        )}
      </div>
      <div className="header-actions">
        <button className="icon-btn" onClick={onHistoryToggle} title="History">
          <Clock size={16} />
        </button>
        <button className="icon-btn" onClick={onNewSession} title="New session">
          <PlusCircle size={16} />
        </button>
      </div>
    </div>
  )
}
