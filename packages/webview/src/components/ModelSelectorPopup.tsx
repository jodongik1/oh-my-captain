import type { ModelInfo } from '../store'

interface ModelSelectorPopupProps {
  models: ModelInfo[]
  currentModelId: string
  onSelect: (model: ModelInfo) => void
  onClose: () => void
}

export default function ModelSelectorPopup({ models, currentModelId, onSelect, onClose }: ModelSelectorPopupProps) {
  return (
    <div className="model-popup">
      <div className="slash-category">모델 선택</div>
      {models.length === 0 && (
        <div style={{ padding: '12px', color: 'var(--fg-muted)', fontSize: 12 }}>
          모델 목록을 불러오는 중...
        </div>
      )}
      {models.map(model => (
        <div
          key={model.id}
          className={`model-item ${model.id === currentModelId ? 'selected' : ''}`}
          onClick={() => { onSelect(model); onClose() }}
        >
          <div className="model-item-name">
            {model.id === currentModelId && '✓ '}{model.name}
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
