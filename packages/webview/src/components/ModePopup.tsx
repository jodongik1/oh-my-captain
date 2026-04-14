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
    name: '편집 전 확인',
    desc: '각 편집 전 Captain이 승인을 요청합니다',
  },
  {
    mode: 'auto',
    icon: <Code size={16} />,
    name: '자동 편집',
    desc: '선택한 텍스트 또는 전체 파일을 Captain이 자동으로 편집합니다',
  },
  {
    mode: 'plan',
    icon: <ClipboardList size={16} />,
    name: '플랜 모드',
    desc: '편집 전 코드를 탐색하고 계획을 먼저 제시합니다',
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
          <span className="mode-popup-title">모드</span>
          <span className="mode-popup-hint">
            <kbd>⇧</kbd> + <kbd>tab</kbd> 으로 전환
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
