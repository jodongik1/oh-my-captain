// 입력창 하단 액션 영역: 좌측 (컨텍스트 추가/슬래시/사용량), 우측 (모드/전송 또는 중단).
import { Plus, SquareSlash, ArrowUp, Square, FileText, Code, ClipboardList } from 'lucide-react'
import type { Mode } from '../../store'
import ModePopup from '../ModePopup'

interface Props {
  mode: Mode
  isBusy: boolean
  hasText: boolean
  showAddContext: boolean
  showActionMenu: boolean
  showModePopup: boolean
  ctxPct: number
  ctxLevel: 'normal' | 'warn' | 'critical'
  ctxTitle: string
  onToggleAddContext: () => void
  onToggleActionMenu: () => void
  onToggleModePopup: () => void
  onModeChange: (m: Mode) => void
  onCloseModePopup: () => void
  onAbort: () => void
  onSend: () => void
}

const MODE_LABELS: Record<Mode, string> = {
  plan: '플랜 모드',
  ask: '편집 전 확인',
  auto: '자동 편집',
}

function ModeIcon({ mode, size = 14 }: { mode: Mode; size?: number }) {
  switch (mode) {
    case 'ask':   return <FileText size={size} />
    case 'auto':  return <Code size={size} />
    case 'plan':  return <ClipboardList size={size} />
  }
}

export default function InputFooter({
  mode, isBusy, hasText, showAddContext, showActionMenu, showModePopup,
  ctxPct, ctxLevel, ctxTitle,
  onToggleAddContext, onToggleActionMenu, onToggleModePopup,
  onModeChange, onCloseModePopup, onAbort, onSend,
}: Props) {
  return (
    <div className="input-footer">
      <div className="footer-left">
        <button
          className={`${showAddContext ? 'active' : ''} footer-icon-btn`}
          onClick={onToggleAddContext}
          title="컨텍스트 추가"
        >
          <Plus size={16} />
        </button>
        <button
          className={`${showActionMenu ? 'active' : ''} footer-icon-btn`}
          onClick={onToggleActionMenu}
          title="명령어"
        >
          <SquareSlash size={16} />
        </button>
        {ctxPct > 0 && (
          <div className={`context-usage ctx-${ctxLevel}`} title={ctxTitle}>
            <div className="context-bar">
              <div className="context-fill" style={{ width: `${ctxPct}%` }} />
            </div>
            <span className="context-pct">{ctxPct}%</span>
          </div>
        )}
      </div>

      <div className="footer-spacer" />

      <div className="footer-right footer-right-relative">
        {showModePopup && (
          <ModePopup currentMode={mode} onSelect={onModeChange} onClose={onCloseModePopup} />
        )}

        <button className={`mode-switch-btn mode-${mode}`} onClick={onToggleModePopup} title="모드 전환 (Shift+Tab)">
          <ModeIcon mode={mode} />
          <span>{MODE_LABELS[mode]}</span>
        </button>

        {isBusy ? (
          <button className="stop-btn" onClick={onAbort} title="중단">
            <Square size={12} fill="white" />
          </button>
        ) : (
          <button
            className={`send-btn mode-${mode}`}
            disabled={!hasText}
            onClick={onSend}
            title="전송 (Enter)"
          >
            <ArrowUp size={16} strokeWidth={2.5} />
          </button>
        )}
      </div>
    </div>
  )
}
