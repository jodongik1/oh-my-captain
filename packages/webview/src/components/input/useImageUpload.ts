// 이미지 파일 선택 → base64 + 픽셀 크기 측정 → Attachment 변환.
import { useCallback, useRef } from 'react'
import type { Attachment } from '../../store'

const MAX_BYTES = 8 * 1024 * 1024

export function useImageUpload(onAdd: (attachments: Attachment[]) => void) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const trigger = useCallback(() => fileInputRef.current?.click(), [])

  const onChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''  // 동일 파일 재선택 가능하게 reset
    if (files.length === 0) return

    const accepted: Attachment[] = []
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue
      if (f.size > MAX_BYTES) continue
      const dataUrl = await readAsDataUrl(f)
      const commaIdx = dataUrl.indexOf(',')
      const data = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : ''
      const dims = await measureImage(dataUrl)
      accepted.push({
        kind: 'image',
        mediaType: f.type,
        data,
        filename: f.name,
        dataUrl,
        width: dims.w || undefined,
        height: dims.h || undefined,
        size: f.size,
      })
    }
    if (accepted.length > 0) onAdd(accepted)
  }, [onAdd])

  return { fileInputRef, trigger, onChange }
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}

function measureImage(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => resolve({ w: 0, h: 0 })
    img.src = dataUrl
  })
}
