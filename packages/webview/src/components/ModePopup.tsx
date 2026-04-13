import { useEffect, useCallback } from 'react'
import type { Mode } from '../store'
import { FileText, Code, ClipboardList, Check } from 'lucide-react'

interface ModePopupProps {
  currentMode: Mode
  onSelect: (mode: Mode) => void
  onClose: () => void
}

const MODES: { mode: Mode; icon: React.ReactNode; name: string; desc: string }[] = [
  {
    mode: 'ask',
    icon: <FileText size={16} />,
    name: 'Ask before edits',
    desc: 'Captain will ask for approval before making each edit',
  },
  {
    mode: 'auto',
    icon: <Code size={16} />,
    name: 'Edit automatically',
    desc: 'Captain will edit your selected text or the whole file',
  },
  {
    mode: 'plan',
    icon: <ClipboardList size={16} />,
    name: 'Plan mode',
    desc: 'Captain will explore the code and present a plan before editing',
  },
]

export default function ModePopup({ currentMode, onSelect, onClose }: ModePopupProps) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }, [onClose])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  return (
    <>
      <div className="mode-popup-overlay" onClick={onClose} />
      <div className="mode-popup">
        <div className="mode-popup-header">
          <span className="mode-popup-title">Modes</span>
          <span className="mode-popup-hint">
            <kbd>⇧</kbd> + <kbd>tab</kbd> to switch
          </span>
        </div>
        <div className="mode-popup-list">
          {MODES.map(m => (
            <div
              key={m.mode}
              className={`mode-popup-item ${currentMode === m.mode ? 'active' : ''}`}
              onClick={() => { onSelect(m.mode); onClose() }}
            >
              <span className="mode-popup-item-icon">{m.icon}</span>
              <div className="mode-popup-item-content">
                <div className="mode-popup-item-name">{m.name}</div>
                <div className="mode-popup-item-desc">{m.desc}</div>
              </div>
              {currentMode === m.mode && (
                <span className="mode-popup-item-check">
                  <Check size={16} />
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
