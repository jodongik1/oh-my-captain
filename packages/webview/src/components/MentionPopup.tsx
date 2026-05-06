import { useEffect, useRef } from 'react'
import { FileText, Folder } from 'lucide-react'

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
        <div className="mention-popup-list" ref={listRef}>
          {files.map((file, idx) => {
            const isDir = file.endsWith('/')
            const Icon = isDir ? Folder : FileText
            // 파일은 basename / dirname 분리 표시. 폴더는 path 전체를 좌측에.
            const lastSlash = isDir ? -1 : file.lastIndexOf('/')
            const basename = isDir || lastSlash < 0 ? file : file.slice(lastSlash + 1)
            const dirname = !isDir && lastSlash >= 0 ? file.slice(0, lastSlash + 1) : ''
            return (
              <div
                key={idx}
                className={`mention-popup-item ${idx === selectedIndex ? 'selected' : ''}`}
                onClick={() => onSelect(file)}
              >
                <div className="mention-popup-item-left">
                  <Icon size={14} className="mention-icon" />
                  <span className="mention-file-basename">{basename}</span>
                </div>
                {dirname && <span className="mention-file-dirname">{dirname}</span>}
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
