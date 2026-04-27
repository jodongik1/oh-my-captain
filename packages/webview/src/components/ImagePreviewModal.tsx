import { useEffect } from 'react'
import { X } from 'lucide-react'
import type { Attachment } from '../store'

interface ImagePreviewModalProps {
  attachment: Attachment
  onClose: () => void
}

/**
 * 첨부 이미지 확대 미리보기. 배경 클릭/ESC/× 로 닫힘.
 */
export default function ImagePreviewModal({ attachment, onClose }: ImagePreviewModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    // 모달 열려있는 동안 body 스크롤 잠금
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', handler)
      document.body.style.overflow = prev
    }
  }, [onClose])

  return (
    <div className="image-preview-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <button
        type="button"
        className="image-preview-close"
        onClick={onClose}
        title="닫기 (Esc)"
        aria-label="닫기"
      >
        <X size={18} />
      </button>
      <img
        src={attachment.dataUrl}
        alt={attachment.filename ?? 'preview'}
        className="image-preview-img"
        onClick={(e) => e.stopPropagation()}
      />
      {(attachment.filename || attachment.width) && (
        <div className="image-preview-meta" onClick={(e) => e.stopPropagation()}>
          {attachment.filename && <span className="image-preview-name">{attachment.filename}</span>}
          {attachment.width && attachment.height && (
            <span className="image-preview-dims">{attachment.width}×{attachment.height}</span>
          )}
        </div>
      )}
    </div>
  )
}
