import { useState, useEffect, useCallback } from 'react'
import { sendToHost } from '../bridge/jcef'
import type { SessionSummary } from '../store'
import HistorySessionItem from './HistorySessionItem'

interface HistoryPopupProps {
  sessions: SessionSummary[]
  currentSessionId: string | null
  onSelect: (sessionId: string, title: string) => void
  onDelete: (sessionId: string) => void
  onRename: (sessionId: string, newTitle: string) => void
  onClose: () => void
}

export default function HistoryPopup({
  sessions, currentSessionId, onSelect, onDelete, onRename, onClose
}: HistoryPopupProps) {
  const [search, setSearch] = useState('')

  const filtered = sessions.filter(s =>
    s.title.toLowerCase().includes(search.toLowerCase())
  )

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }, [onClose])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  return (
    <>
      <div className="popup-overlay" onClick={onClose} />
      <div className="history-popup">
        <div className="history-search">
          <input
            autoFocus
            placeholder="🔍 Search sessions..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="history-list">
          {filtered.length === 0 && (
            <div style={{ padding: '16px', color: 'var(--fg-muted)', fontSize: 13, textAlign: 'center' }}>
              {sessions.length === 0 ? '아직 대화가 없습니다' : '검색 결과 없음'}
            </div>
          )}
          {filtered.map(session => (
            <HistorySessionItem
              key={session.id}
              session={session}
              isActive={session.id === currentSessionId}
              onSelect={() => {
                onSelect(session.id, session.title)
                sendToHost({ type: 'session_select', payload: { sessionId: session.id } })
              }}
              onDelete={() => {
                onDelete(session.id)
                sendToHost({ type: 'session_delete', payload: { sessionId: session.id } })
              }}
              onRename={(newTitle) => {
                onRename(session.id, newTitle)
                sendToHost({ type: 'session_rename', payload: { sessionId: session.id, title: newTitle } })
              }}
            />
          ))}
        </div>
      </div>
    </>
  )
}
