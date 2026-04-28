// textarea 본체 + 멘션 하이라이트 오버레이.
// 키보드/onChange 처리는 부모의 핸들러를 그대로 전달받는다 — 외부 상태(슬래시/멘션)에 영향받기 때문.
import { type RefObject } from 'react'

interface Props {
  text: string
  placeholder: string
  isFocused: boolean
  textareaRef: RefObject<HTMLTextAreaElement>
  overlayRef: RefObject<HTMLDivElement>
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  onFocus: () => void
  onBlur: () => void
}

export default function InputTextarea({
  text, placeholder, isFocused, textareaRef, overlayRef,
  onChange, onKeyDown, onFocus, onBlur,
}: Props) {
  return (
    <div className="textarea-container textarea-container-relative">
      <div
        ref={overlayRef}
        className="textarea-overlay"
        aria-hidden="true"
      >
        {text === '' && !isFocused && (
          <span className="textarea-placeholder">{placeholder}</span>
        )}
        {text.split(/(@\S+)/g).map((part, i) => {
          if (part.startsWith('@') && part.length > 1) {
            return <span key={i} className="mention-pill">{part}</span>
          }
          return <span key={i}>{part}</span>
        })}
        {text.endsWith('\n') ? <br /> : null}
      </div>
      <textarea
        ref={textareaRef}
        className="input-field input-field-overlay-host"
        value={text}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onBlur={onBlur}
        rows={1}
        onScroll={(e) => {
          if (overlayRef.current) {
            overlayRef.current.scrollTop = (e.target as HTMLTextAreaElement).scrollTop
          }
        }}
        onInput={(e) => {
          const t = e.target as HTMLTextAreaElement
          t.style.height = 'auto'
          t.style.height = Math.min(t.scrollHeight, 140) + 'px'
        }}
      />
    </div>
  )
}
