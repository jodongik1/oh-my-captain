import { useState, useRef, useCallback } from 'react'
import { sendToHost } from '../bridge/jcef'
import type { Mode, ModelInfo, AppState } from '../store'
import SlashCommandPopup, { type SlashCommand } from './SlashCommandPopup'
import ModelSelectorPopup from './ModelSelectorPopup'
import ModePopup from './ModePopup'
import { Plus, SquareSlash, ArrowUp, Square, FileText, Code, ClipboardList, Upload, Globe } from 'lucide-react'

interface InputConsoleProps {
  mode: Mode
  contextUsage: AppState['contextUsage']
  isBusy: boolean
  currentModel: string
  availableModels: ModelInfo[]
  showModelSelector: boolean
  slashFilter: string | null
  onSend: (text: string) => void
  onModeChange: (mode: Mode) => void
  onAbort: () => void
  onSlashFilterChange: (filter: string | null) => void
  onToggleModelSelector: () => void
  onModelSelect: (model: ModelInfo) => void
  onNewSession: () => void
  onOpenSettings: () => void
}

const MODE_LABELS: Record<Mode, string> = {
  plan: '플랜 모드',
  ask: '편집 전 확인',
  auto: '자동 편집',
}

const MODES: Mode[] = ['ask', 'auto', 'plan']

function ModeIcon({ mode, size = 14 }: { mode: Mode; size?: number }) {
  switch (mode) {
    case 'ask':   return <FileText size={size} />
    case 'auto':  return <Code size={size} />
    case 'plan':  return <ClipboardList size={size} />
  }
}

export default function InputConsole({
  mode, contextUsage, isBusy, currentModel, availableModels,
  showModelSelector, slashFilter, onSend, onModeChange, onAbort,
  onSlashFilterChange, onToggleModelSelector, onModelSelect,
  onNewSession, onOpenSettings
}: InputConsoleProps) {
  const [text, setText] = useState('')
  const [showModePopup, setShowModePopup] = useState(false)
  const [showActionMenu, setShowActionMenu] = useState(false)
  const [showAddContext, setShowAddContext] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // suppress unused var
  void contextUsage

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault()
      const idx = MODES.indexOf(mode)
      onModeChange(MODES[(idx + 1) % MODES.length])
      return
    }
    // [흐름 1] Enter 입력 → onSend 호출 → App.tsx의 handleSend로 이어짐
    // Shift+Enter는 줄바꿈, 슬래시 팝업/액션 메뉴 열려있으면 전송 억제
    if (e.key === 'Enter' && !e.shiftKey && !slashFilter && !showActionMenu) {
      e.preventDefault()
      if (text.trim() && !isBusy) {
        console.log('[InputConsole] Sending message:', text.trim())
        onSend(text.trim())
        setText('')
        onSlashFilterChange(null)
      }
      return
    }
    if (e.key === 'Escape') {
      onSlashFilterChange(null)
      setShowModePopup(false)
      setShowActionMenu(false)
    }
  }, [mode, text, isBusy, slashFilter, showActionMenu, onSend, onModeChange, onSlashFilterChange])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    setText(val)
    if (val.startsWith('/')) {
      onSlashFilterChange(val)
    } else {
      onSlashFilterChange(null)
      setShowActionMenu(false)
    }
  }, [onSlashFilterChange])

  const buildCommands = (): SlashCommand[] => [
    {
      name: '/model', label: '모델 변경', category: '모델',
      description: currentModel ? `현재: ${currentModel}` : '기본값 (권장)',
      action: () => {
        onToggleModelSelector()
        onSlashFilterChange(null)
        setShowActionMenu(false)
        setText('')
        sendToHost({ type: 'model_list', payload: {} })
      }
    },
    {
      name: '/new', label: '새 대화', category: '사용자 설정',
      action: () => { onNewSession(); onSlashFilterChange(null); setShowActionMenu(false); setText('') }
    },
    {
      name: '/settings', label: '설정', category: '사용자 설정',
      action: () => { onOpenSettings(); onSlashFilterChange(null); setShowActionMenu(false); setText('') }
    },
  ]

  return (
    <div className="input-console">
      <div className="input-console-popups">
        {showAddContext && (
          <>
            <div className="slash-popup-overlay" onClick={() => setShowAddContext(false)} />
            <div className="add-context-popup">
              <div className="add-context-item">
                <Upload size={14}/> <span>파일 업로드</span>
              </div>
              <div className="add-context-item">
                <FileText size={14}/> <span>컨텍스트 추가</span>
              </div>
              <div className="add-context-item">
                <Globe size={14}/> <span>웹 검색</span>
              </div>
            </div>
          </>
        )}
        {(slashFilter !== null || showActionMenu) && (
          <SlashCommandPopup
            commands={buildCommands()}
            filter={slashFilter || ''}
            showFilterInput={showActionMenu}
            onSelect={(cmd) => cmd.action()}
            onClose={() => { onSlashFilterChange(null); setShowActionMenu(false); }}
          />
        )}
        {showModelSelector && (
          <ModelSelectorPopup
            models={availableModels}
            currentModelId={currentModel}
            onSelect={onModelSelect}
            onClose={onToggleModelSelector}
          />
        )}
      </div>

      <div className={`input-wrapper ${isFocused ? 'mode-' + mode + ' focused' : ''}`}>
        <textarea
          ref={textareaRef}
          className="input-field"
          placeholder={isBusy ? 'Captain이 작업 중입니다...' : '⌘ Esc로 Captain에 포커스하거나 해제하세요'}
          value={text}
          disabled={isBusy}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          rows={1}
          style={{ height: 'auto' }}
          onInput={(e) => {
            const t = e.target as HTMLTextAreaElement
            t.style.height = 'auto'
            t.style.height = Math.min(t.scrollHeight, 140) + 'px'
          }}
        />

        <div className="input-footer">
          <div className="footer-left">
            <button className={`${showAddContext ? 'active' : ''} footer-icon-btn`} onClick={() => setShowAddContext(!showAddContext)} title="컨텍스트 추가">
              <Plus size={16} />
            </button>
            <button className={`${showActionMenu ? 'active' : ''} footer-icon-btn`} onClick={() => setShowActionMenu(!showActionMenu)} title="명령어">
              <SquareSlash size={16} />
            </button>
          </div>

          <div className="footer-spacer" />

          <div className="footer-right" style={{ position: 'relative' }}>
            {showModePopup && (
              <ModePopup
                currentMode={mode}
                onSelect={onModeChange}
                onClose={() => setShowModePopup(false)}
              />
            )}

            <button
              className={`mode-switch-btn mode-${mode}`}
              onClick={() => setShowModePopup(!showModePopup)}
              title="모드 전환 (Shift+Tab)"
            >
              <ModeIcon mode={mode} />
              <span>{MODE_LABELS[mode]}</span>
            </button>

            {isBusy ? (
              <button className="stop-btn" onClick={onAbort}>
                <Square size={12} fill="white" />
              </button>
            ) : (
              <button
                className={`send-btn mode-${mode}`}
                disabled={!text.trim() || isBusy}
                // [흐름 1-버튼] 전송 버튼 클릭도 동일하게 onSend 호출
                onClick={() => {
                  if (text.trim()) { onSend(text.trim()); setText('') }
                }}
                title="전송 (Enter)"
              >
                <ArrowUp size={16} strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
