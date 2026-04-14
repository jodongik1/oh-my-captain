import { useEffect, useRef, useState } from 'react'

export interface SlashCommand {
  name: string
  label: string
  category: string
  description?: string
  action: () => void
  requiresSelection?: boolean
}

interface SlashCommandPopupProps {
  commands: SlashCommand[]
  filter: string
  showFilterInput?: boolean
  onSelect: (cmd: SlashCommand) => void
  onClose: () => void
}

export default function SlashCommandPopup({ commands, filter, showFilterInput, onSelect, onClose }: SlashCommandPopupProps) {
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [localFilter, setLocalFilter] = useState('')
  const popupRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (showFilterInput && inputRef.current) {
      inputRef.current.focus()
    }
  }, [showFilterInput])

  const effectiveFilter = showFilterInput ? localFilter : filter
  const query = effectiveFilter.startsWith('/') ? effectiveFilter.slice(1).toLowerCase() : effectiveFilter.toLowerCase()
  
  const filtered = query
    ? commands.filter(c =>
        c.name.toLowerCase().includes(query) ||
        c.label.toLowerCase().includes(query) ||
        c.category.toLowerCase().includes(query)
      )
    : commands

  // 카테고리별 그룹화
  const categories = Array.from(new Set(filtered.map(c => c.category)))

  useEffect(() => { setSelectedIdx(0) }, [effectiveFilter])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Input 필드 안에서 상/하 방향키 누를 때 커서 이동 방지
      if (document.activeElement === inputRef.current && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault()
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIdx(i => Math.min(i + 1, filtered.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIdx(i => Math.max(i - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (filtered[selectedIdx]) onSelect(filtered[selectedIdx])
      } else if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [filtered, selectedIdx, onSelect, onClose])

  if (filtered.length === 0 && !showFilterInput) return null

  let globalIdx = 0
  return (
    <>
      <div className="slash-popup-overlay" onClick={onClose} />
      <div className="slash-popup" ref={popupRef}>
        {showFilterInput && (
          <div className="slash-popup-search">
            <input
              ref={inputRef}
              type="text"
              placeholder="명령어 검색..."
              value={localFilter}
              onChange={e => setLocalFilter(e.target.value)}
            />
          </div>
        )}
        <div className="slash-popup-content">
          {categories.map(cat => {
            const items = filtered.filter(c => c.category === cat)
            return (
              <div key={cat}>
                <div className="slash-category">{cat}</div>
                {items.map(cmd => {
                  const idx = globalIdx++
                  return (
                    <div
                      key={cmd.name}
                      className={`slash-item ${idx === selectedIdx ? 'selected' : ''}`}
                      onClick={() => onSelect(cmd)}
                      onMouseEnter={() => setSelectedIdx(idx)}
                    >
                      <span className="slash-item-name">{cmd.label || cmd.name}</span>
                      {cmd.description && <span className="slash-item-right">{cmd.description}</span>}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
