import { useEffect, useRef, useState } from 'react'
import type { ModelInfo } from '../store'

interface ModelSelectorPopupProps {
  models: ModelInfo[]
  currentModelId: string
  onSelect: (model: ModelInfo) => void
  onClose: () => void
}

export default function ModelSelectorPopup({ models, currentModelId, onSelect, onClose }: ModelSelectorPopupProps) {
  const initialIdx = Math.max(0, models.findIndex(m => m.id === currentModelId))
  const [focusedIdx, setFocusedIdx] = useState(initialIdx)
  const [checkedId, setCheckedId] = useState(currentModelId)
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])

  useEffect(() => {
    itemRefs.current[focusedIdx]?.scrollIntoView({ block: 'nearest' })
  }, [focusedIdx])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setFocusedIdx(i => Math.min(i + 1, models.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setFocusedIdx(i => Math.max(i - 1, 0))
      } else if (e.key === ' ') {
        e.preventDefault()
        if (models[focusedIdx]) setCheckedId(models[focusedIdx].id)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (models[focusedIdx]) onSelect(models[focusedIdx])
      } else if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [models, focusedIdx, onSelect, onClose])

  return (
    <div className="model-popup">
      <div className="slash-category">모델 선택</div>
      {models.length === 0 && (
        <div style={{ padding: '12px', color: 'var(--fg-muted)', fontSize: 12 }}>
          모델 목록을 불러오는 중...
        </div>
      )}
      {models.map((model, idx) => (
        <div
          key={model.id}
          ref={el => { itemRefs.current[idx] = el }}
          className={`model-item ${idx === focusedIdx ? 'focused' : ''} ${model.id === checkedId ? 'selected' : ''}`}
          onClick={() => onSelect(model)}
          onMouseEnter={() => setFocusedIdx(idx)}
        >
          <div className="model-item-name">
            {model.id === checkedId && '✓ '}{model.name}
          </div>
          {model.contextWindow && (
            <div className="model-item-info">
              컨텍스트: {model.contextWindow.toLocaleString()} 토큰
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
