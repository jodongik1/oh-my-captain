import { useState, useRef, useCallback } from 'react'
import { sendToHost } from '../bridge/jcef'
import type { Mode, ModelInfo, AppState } from '../store'
import SlashCommandPopup, { type SlashCommand } from './SlashCommandPopup'
import ModelSelectorPopup from './ModelSelectorPopup'
import ModePopup from './ModePopup'
import { Plus, SquareSlash, ArrowUp, Square, FileText, Code, ClipboardList, Upload, Globe } from 'lucide-react'

import MentionPopup from './MentionPopup'

interface InputConsoleProps {
  mode: Mode
  contextUsage: AppState['contextUsage']
  isBusy: boolean
  currentModel: string
  availableModels: ModelInfo[]
  showModelSelector: boolean
  slashFilter: string | null
  fileSearchResults: string[]
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
  showModelSelector, slashFilter, fileSearchResults, onSend, onModeChange, onAbort,
  onSlashFilterChange, onToggleModelSelector, onModelSelect,
  onNewSession, onOpenSettings
}: InputConsoleProps) {
  const [text, setText] = useState('')
  const [showModePopup, setShowModePopup] = useState(false)
  const [showActionMenu, setShowActionMenu] = useState(false)
  const [showAddContext, setShowAddContext] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const [atFilter, setAtFilter] = useState<{ query: string; index: number } | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  // suppress unused var
  void contextUsage

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 멘션 팝업이 열려있을 때의 키보드 제어
    if (atFilter !== null) {
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionIndex(prev => Math.max(0, prev - 1))
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionIndex(prev => Math.min(fileSearchResults.length - 1, prev + 1))
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        if (fileSearchResults[mentionIndex]) {
          handleMentionSelect(fileSearchResults[mentionIndex])
        }
        return
      }
    }

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
      setAtFilter(null)
    }
  }, [mode, text, isBusy, slashFilter, showActionMenu, atFilter, mentionIndex, fileSearchResults, onSend, onModeChange, onSlashFilterChange])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    setText(val)
    
    // Slash command check
    if (val.startsWith('/')) {
      onSlashFilterChange(val)
      setAtFilter(null)
    } else {
      onSlashFilterChange(null)
      setShowActionMenu(false)
      
      // Mention check (@)
      const cursor = e.target.selectionStart
      const textBeforeCursor = val.slice(0, cursor)
      const match = /(?:^|\s)(@([^\s]*))$/.exec(textBeforeCursor)
      
      if (match) {
        const query = match[2]
        const index = match.index + (match[0].startsWith(' ') ? 1 : 0) // @의 시작 인덱스
        setAtFilter({ query, index })
        setMentionIndex(0)
        sendToHost({ type: 'file_search', payload: { query } })
      } else {
        setAtFilter(null)
      }
    }
  }, [onSlashFilterChange])

  const handleMentionSelect = useCallback((file: string) => {
    if (!atFilter) return
    const before = text.slice(0, atFilter.index)
    // 현재 커서 위치를 찾기 위해 @ 부터 커서까지의 길이를 계산해야 하나,
    // 간단히 마지막 @ 부분만 대체한다고 가정.
    const match = /(?:^|\s)(@([^\s]*))$/.exec(text.slice(0, textareaRef.current?.selectionStart || text.length))
    if (match) {
       const replaceStart = match.index + (match[0].startsWith(' ') ? 1 : 0)
       const replaceEnd = replaceStart + match[1].length
       const newText = text.slice(0, replaceStart) + `@${file} ` + text.slice(replaceEnd)
       setText(newText)
    } else {
       // fallback
       setText(before + `@${file} `)
    }
    setAtFilter(null)
    textareaRef.current?.focus()
  }, [text, atFilter])

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
        {atFilter !== null && (
          <MentionPopup
            files={fileSearchResults}
            selectedIndex={mentionIndex}
            onSelect={handleMentionSelect}
            onClose={() => setAtFilter(null)}
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
        <div className="textarea-container" style={{ position: 'relative' }}>
          <div 
            ref={overlayRef}
            className="textarea-overlay" 
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              pointerEvents: 'none',
              padding: '12px 14px',
              fontFamily: 'var(--font-sans)',
              fontSize: '14px',
              lineHeight: '1.5',
              whiteSpace: 'pre-wrap',
              wordWrap: 'break-word',
              color: 'var(--fg-primary)',
              overflowY: 'hidden'
            }}
          >
            {text === '' && (
              <span style={{ color: 'var(--fg-faint)', userSelect: 'none' }}>
                {isBusy ? 'Captain이 작업 중입니다...' : '⌘ Esc로 Captain에 포커스하거나 해제하세요'}
              </span>
            )}
            {text.split(/(@\S+)/g).map((part, i) => {
              if (part.startsWith('@') && part.length > 1) {
                return <span key={i} className="mention-pill">{part}</span>
              }
              return <span key={i}>{part}</span>
            })}
            {/* textarea 커서 싱크를 위해 맨 끝에 공백 유지 */}
            {text.endsWith('\n') ? <br /> : null}
          </div>
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
            style={{ 
              height: 'auto', 
              position: 'relative', 
              background: 'transparent',
              color: 'transparent',
              caretColor: 'var(--text-primary)' 
            }}
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
