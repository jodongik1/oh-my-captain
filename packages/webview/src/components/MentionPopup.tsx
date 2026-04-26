import { useEffect, useRef } from 'react'
import { FileText } from 'lucide-react'

export interface MentionPopupProps {
  files: string[]
  selectedIndex: number
  onSelect: (file: string) => void
  onClose: () => void
}

export default function MentionPopup({ files, selectedIndex, onSelect, onClose }: MentionPopupProps) {
  const popupRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  useEffect(() => {
    if (listRef.current) {
      const selectedEl = listRef.current.children[selectedIndex] as HTMLElement
      if (selectedEl) {
        selectedEl.scrollIntoView({ block: 'nearest' })
      }
    }
  }, [selectedIndex])

  if (files.length === 0) return null

  return (
    <>
      <div className="slash-popup-overlay" onClick={onClose} />
      <div className="mention-popup" ref={popupRef}>
        <div className="mention-popup-header">파일 멘션</div>
        <div className="mention-popup-list" ref={listRef}>
          {files.map((file, idx) => (
            <div
              key={idx}
              className={`mention-popup-item ${idx === selectedIndex ? 'selected' : ''}`}
              onClick={() => onSelect(file)}
            >
              <FileText size={14} className="mention-icon" />
              <div className="mention-file-path">
                {file}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
