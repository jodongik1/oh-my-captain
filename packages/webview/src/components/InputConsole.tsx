// 입력 콘솔 — 텍스트 입력 + 첨부 + 슬래시/멘션/모드/모델 팝업의 오케스트레이터.
// 표현은 input/* 하위 컴포넌트에 위임하고, 본 파일은 상태/콜백 결합만 담당한다.
import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import type { Mode, ModelInfo, AppState, ActivityState, Attachment } from '../store'
import { isMultimodalModel } from '../utils/modelCapabilities'
import SlashCommandPopup from './SlashCommandPopup'
import ModelSelectorPopup from './ModelSelectorPopup'
import { Upload, AtSign } from 'lucide-react'
import MentionPopup from './MentionPopup'
import AttachmentTray from './input/AttachmentTray'
import InputTextarea from './input/InputTextarea'
import InputFooter from './input/InputFooter'
import { useImageUpload } from './input/useImageUpload'
import { useMentionAutocomplete } from './input/useMentionAutocomplete'
import { buildSlashCommands } from './input/buildSlashCommands'
import { useHostBridge } from '../bridge/HostBridgeContext'

interface InputConsoleProps {
  mode: Mode
  contextUsage: AppState['contextUsage']
  isBusy: boolean
  currentActivity?: ActivityState | null
  currentModel: string
  availableModels: ModelInfo[]
  showModelSelector: boolean
  slashFilter: string | null
  fileSearchResults: string[]
  pendingAttachments: Attachment[]
  /** core 가 provider API 로 받아온 capability — 'vision' 등 */
  currentModelCapabilities: string[]
  onSend: (text: string) => void
  onModeChange: (mode: Mode) => void
  onAbort: () => void
  onSlashFilterChange: (filter: string | null) => void
  onToggleModelSelector: () => void
  onModelSelect: (model: ModelInfo) => void
  onNewSession: () => void
  onOpenSettings: () => void
  onAttachmentsAdd: (attachments: Attachment[]) => void
  onAttachmentRemove: (index: number) => void
  onToggleHistory: () => void
}

const MODES: Mode[] = ['ask', 'auto', 'plan']

export default function InputConsole({
  mode, contextUsage, isBusy, currentActivity, currentModel, availableModels,
  showModelSelector, slashFilter, fileSearchResults, pendingAttachments,
  currentModelCapabilities,
  onSend, onModeChange, onAbort,
  onSlashFilterChange, onToggleModelSelector, onModelSelect,
  onNewSession, onOpenSettings,
  onAttachmentsAdd, onAttachmentRemove, onToggleHistory,
}: InputConsoleProps) {
  const [text, setText] = useState('')
  const [showModePopup, setShowModePopup] = useState(false)
  const [showActionMenu, setShowActionMenu] = useState(false)
  const [showAddContext, setShowAddContext] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const bridge = useHostBridge()

  const upload = useImageUpload(onAttachmentsAdd)
  const mention = useMentionAutocomplete(textareaRef)

  // 1순위: core 가 동적 조회한 capabilities. 2순위: 모델 이름 패턴 fallback.
  const supportsImages = currentModelCapabilities.length > 0
    ? currentModelCapabilities.includes('vision')
    : isMultimodalModel(currentModel)

  // 동적 placeholder: 유휴/작업 중에 따라 안내 변경
  const placeholder = useMemo(() => {
    const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
    const focusKey = isMac ? '⌘ Esc' : 'Ctrl+Esc'
    if (isBusy) {
      return currentActivity
        ? `Captain이 ${currentActivity.label}... · 메시지를 입력하면 즉시 전달됩니다`
        : 'Captain이 작업 중입니다... · 메시지를 입력하면 즉시 전달됩니다'
    }
    return `${focusKey}로 Captain에 포커스하거나 해제하세요`
  }, [isBusy, currentActivity])

  // 글로벌 단축키: Cmd/Ctrl+Esc → 입력창 포커스 토글
  useEffect(() => {
    const onGlobalKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (!(e.metaKey || e.ctrlKey)) return
      const ta = textareaRef.current
      if (!ta) return
      e.preventDefault()
      if (document.activeElement === ta) ta.blur()
      else ta.focus()
    }
    window.addEventListener('keydown', onGlobalKey)
    return () => window.removeEventListener('keydown', onGlobalKey)
  }, [])

  // 컨텍스트 사용량 가시화
  const ctxPct = Math.max(0, Math.min(100, Math.round(contextUsage?.percentage ?? 0)))
  const ctxLevel: 'normal' | 'warn' | 'critical' = ctxPct >= 90 ? 'critical' : ctxPct >= 80 ? 'warn' : 'normal'
  const ctxTitle = contextUsage
    ? `${contextUsage.usedTokens.toLocaleString()} / ${contextUsage.maxTokens.toLocaleString()} 토큰 (${ctxPct}%)`
    : '컨텍스트 사용량'

  const submit = useCallback(() => {
    if (!text.trim()) return
    onSend(text.trim())
    setText('')
    onSlashFilterChange(null)
  }, [text, onSend, onSlashFilterChange])

  const handleMentionPick = useCallback((file: string) => {
    const cursor = textareaRef.current?.selectionStart ?? text.length
    const next = mention.selectMention(file, text, cursor)
    setText(next)
  }, [mention, text])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention.handleKey(e, fileSearchResults, handleMentionPick)) return

    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault()
      const idx = MODES.indexOf(mode)
      onModeChange(MODES[(idx + 1) % MODES.length])
      return
    }
    if (e.key === 'Enter' && !e.shiftKey && !slashFilter && !showActionMenu && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
      return
    }
    if (e.key === 'Escape') {
      onSlashFilterChange(null)
      setShowModePopup(false)
      setShowActionMenu(false)
      mention.close()
    }
  }, [mode, slashFilter, showActionMenu, submit, onModeChange, onSlashFilterChange, mention, fileSearchResults, handleMentionPick])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    setText(val)
    if (val.startsWith('/')) {
      onSlashFilterChange(val)
      mention.close()
    } else {
      onSlashFilterChange(null)
      setShowActionMenu(false)
      mention.detectFromText(val, e.target.selectionStart)
    }
  }, [onSlashFilterChange, mention])

  const insertMention = useCallback(() => {
    setShowAddContext(false)
    const cursor = textareaRef.current?.selectionStart ?? text.length
    const { next } = mention.insertAtCursor(text, cursor)
    setText(next)
  }, [text, mention])

  const pickFile = useCallback(() => {
    if (!supportsImages) return
    setShowAddContext(false)
    upload.trigger()
  }, [supportsImages, upload])

  const closeSlash = useCallback(() => {
    onSlashFilterChange(null)
    setShowActionMenu(false)
    setText('')
  }, [onSlashFilterChange])

  const slashCommands = useMemo(() => buildSlashCommands({
    bridge, currentModel, onToggleModelSelector, onNewSession, onToggleHistory, onOpenSettings, onSend, closeSlash,
  }), [bridge, currentModel, onToggleModelSelector, onNewSession, onToggleHistory, onOpenSettings, onSend, closeSlash])

  return (
    <div className="input-console">
      <div className="input-console-popups">
        {showAddContext && (
          <>
            <div className="slash-popup-overlay" onClick={() => setShowAddContext(false)} />
            <div className="add-context-popup">
              {supportsImages && (
                <div className="add-context-item" onClick={pickFile} title="이미지 첨부">
                  <Upload size={14}/> <span>파일 업로드</span>
                </div>
              )}
              <div className="add-context-item" onClick={insertMention} title="파일/심볼 멘션 (@)">
                <AtSign size={14}/> <span>컨텍스트 추가</span>
              </div>
            </div>
          </>
        )}
        <input
          ref={upload.fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="file-input-hidden"
          onChange={upload.onChange}
        />
        {(slashFilter !== null || showActionMenu) && (
          <SlashCommandPopup
            commands={slashCommands}
            filter={slashFilter || ''}
            showFilterInput={showActionMenu}
            onSelect={(cmd) => cmd.action()}
            onClose={() => { onSlashFilterChange(null); setShowActionMenu(false) }}
          />
        )}
        {mention.atFilter !== null && (
          <MentionPopup
            files={fileSearchResults}
            selectedIndex={mention.mentionIndex}
            onSelect={handleMentionPick}
            onClose={mention.close}
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

      <AttachmentTray attachments={pendingAttachments} onRemove={onAttachmentRemove} />

      <div className={`input-wrapper ${isFocused ? 'mode-' + mode + ' focused' : ''}`}>
        <InputTextarea
          text={text}
          placeholder={placeholder}
          isFocused={isFocused}
          textareaRef={textareaRef}
          overlayRef={overlayRef}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
        />

        <InputFooter
          mode={mode}
          isBusy={isBusy}
          hasText={Boolean(text.trim())}
          showAddContext={showAddContext}
          showActionMenu={showActionMenu}
          showModePopup={showModePopup}
          ctxPct={ctxPct}
          ctxLevel={ctxLevel}
          ctxTitle={ctxTitle}
          onToggleAddContext={() => setShowAddContext(!showAddContext)}
          onToggleActionMenu={() => setShowActionMenu(!showActionMenu)}
          onToggleModePopup={() => setShowModePopup(!showModePopup)}
          onModeChange={onModeChange}
          onCloseModePopup={() => setShowModePopup(false)}
          onAbort={onAbort}
          onSend={submit}
        />
      </div>
    </div>
  )
}
