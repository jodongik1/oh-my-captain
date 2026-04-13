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
  onClearContext: () => void
  onOpenSettings: () => void
}

const MODE_LABELS: Record<Mode, string> = {
  plan: 'Plan mode',
  ask: 'Ask before edits',
  auto: 'Edit automatically',
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
  onNewSession, onClearContext, onOpenSettings
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
    if (e.key === 'Enter' && !e.shiftKey && !slashFilter && !showActionMenu) {
      e.preventDefault()
      if (text.trim() && !isBusy) {
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
      name: '/clear', label: 'Clear conversation', category: 'Context',
      action: () => { onClearContext(); onSlashFilterChange(null); setShowActionMenu(false); setText('') }
    },
    {
      name: '/explain', label: 'Explain code...', category: 'Context',
      action: () => { onSend('/explain'); onSlashFilterChange(null); setShowActionMenu(false); setText('') }
    },
    {
      name: '/review', label: 'Review code...', category: 'Context',
      action: () => { onSend('/review'); onSlashFilterChange(null); setShowActionMenu(false); setText('') }
    },
    {
      name: '/improve', label: 'Improve code...', category: 'Context',
      action: () => { onSend('/improve'); onSlashFilterChange(null); setShowActionMenu(false); setText('') }
    },
    {
      name: '/test', label: 'Generate test...', category: 'Context',
      action: () => { onSend('/test'); onSlashFilterChange(null); setShowActionMenu(false); setText('') }
    },
    {
      name: '/model', label: 'Switch model...', category: 'Model',
      description: currentModel ? `Current: ${currentModel}` : 'Default (recommended)',
      action: () => {
        onToggleModelSelector()
        onSlashFilterChange(null)
        setShowActionMenu(false)
        setText('')
        sendToHost({ type: 'model_list', payload: {} })
      }
    },
    {
      name: '/new', label: 'New session...', category: 'Customize',
      action: () => { onNewSession(); onSlashFilterChange(null); setShowActionMenu(false); setText('') }
    },
    {
      name: '/settings', label: 'Settings', category: 'Customize',
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
                <Upload size={14}/> <span>Upload from computer</span>
              </div>
              <div className="add-context-item">
                <FileText size={14}/> <span>Add context</span>
              </div>
              <div className="add-context-item">
                <Globe size={14}/> <span>Browse the web</span>
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
          placeholder={isBusy ? 'Captain is working...' : '⌘ Esc to focus or unfocus Captain'}
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
            <button className={`${showAddContext ? 'active' : ''} footer-icon-btn`} onClick={() => setShowAddContext(!showAddContext)} title="Add context">
              <Plus size={16} />
            </button>
            <button className={`${showActionMenu ? 'active' : ''} footer-icon-btn`} onClick={() => setShowActionMenu(!showActionMenu)} title="Commands">
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
              title="Click to switch mode (Shift+Tab)"
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
                onClick={() => {
                  if (text.trim()) { onSend(text.trim()); setText('') }
                }}
                title="Send (Enter)"
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
