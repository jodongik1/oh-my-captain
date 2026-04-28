// 입력창 위에 떠 있는 첨부 카드 트레이 + 클릭 시 미리보기 모달.
import { useState } from 'react'
import { X } from 'lucide-react'
import type { Attachment } from '../../store'
import ImagePreviewModal from '../ImagePreviewModal'

interface Props {
  attachments: Attachment[]
  onRemove: (index: number) => void
}

export default function AttachmentTray({ attachments, onRemove }: Props) {
  const [preview, setPreview] = useState<Attachment | null>(null)

  if (attachments.length === 0) return null

  return (
    <>
      <div className="attachment-strip">
        {attachments.map((att, i) => (
          <div
            key={i}
            className="attachment-card"
            onClick={() => setPreview(att)}
            title="클릭하여 확대"
          >
            <img src={att.dataUrl} alt={att.filename ?? 'attachment'} className="attachment-card-thumb" />
            <div className="attachment-card-meta">
              <div className="attachment-card-name">{att.filename ?? '이미지'}</div>
              {att.width && att.height && (
                <div className="attachment-card-dims">{att.width}×{att.height}</div>
              )}
            </div>
            <button
              type="button"
              className="attachment-card-remove"
              onClick={(e) => { e.stopPropagation(); onRemove(i) }}
              title="제거"
              aria-label="첨부 제거"
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
      {preview && <ImagePreviewModal attachment={preview} onClose={() => setPreview(null)} />}
    </>
  )
}
