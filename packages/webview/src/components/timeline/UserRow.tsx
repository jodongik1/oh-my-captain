// 사용자 메시지 블록 — 첨부 썸네일 + 본문 + 복사 버튼.
import { useState } from 'react'
import type { Attachment } from '../../store'

interface Props {
  content?: string
  attachments?: Attachment[]
  onAttachmentClick: (att: Attachment) => void
}

export default function UserRow({ content, attachments, onAttachmentClick }: Props) {
  return (
    <div className="user-message-block">
      {attachments && attachments.length > 0 && (
        <div className="user-message-attachments">
          {attachments.map((att, i) => (
            <img
              key={i}
              src={att.dataUrl}
              alt={att.filename ?? 'attachment'}
              className="user-message-thumb"
              title={att.filename ?? '클릭하여 확대'}
              onClick={() => onAttachmentClick(att)}
            />
          ))}
        </div>
      )}
      {content && <div className="user-message-text">{content}</div>}
      <UserMessageCopyButton content={content ?? ''} />
    </div>
  )
}

function UserMessageCopyButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button
      className={`user-message-copy-btn ${copied ? 'copied' : ''}`}
      onClick={handleCopy}
      title="내용 복사"
    >
      {copied ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  )
}
