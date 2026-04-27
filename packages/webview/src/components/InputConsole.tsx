import { useState, useRef, useCallback, useEffect } from 'react'
import { sendToHost } from '../bridge/jcef'
import type { Mode, ModelInfo, AppState, ActivityState, Attachment } from '../store'
import { isMultimodalModel } from '../utils/modelCapabilities'
import SlashCommandPopup, { type SlashCommand } from './SlashCommandPopup'
import ModelSelectorPopup from './ModelSelectorPopup'
import ModePopup from './ModePopup'
import { Plus, SquareSlash, ArrowUp, Square, FileText, Code, ClipboardList, Upload, AtSign, X } from 'lucide-react'

import MentionPopup from './MentionPopup'
import ImagePreviewModal from './ImagePreviewModal'

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
  mode, contextUsage, isBusy, currentActivity, currentModel, availableModels,
  showModelSelector, slashFilter, fileSearchResults, pendingAttachments,
  currentModelCapabilities,
  onSend, onModeChange, onAbort,
  onSlashFilterChange, onToggleModelSelector, onModelSelect,
  onNewSession, onOpenSettings,
  onAttachmentsAdd, onAttachmentRemove,
  onToggleHistory,
}: InputConsoleProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  // 1순위: core 가 동적 조회한 capabilities. 2순위: 모델 이름 패턴 fallback.
  const supportsImages = currentModelCapabilities.length > 0
    ? currentModelCapabilities.includes('vision')
    : isMultimodalModel(currentModel)
  const [previewAttachment, setPreviewAttachment] = useState<Attachment | null>(null)
  // 동적 placeholder:
  // - 유휴 시: 단축키 안내 (OS 별로 키 라벨 분기)
  // - 작업 중 + 입력 비어있음: 현재 활동 라벨 ("Captain이 Bash 실행 중...")
  // - 작업 중 + 입력 시작: steering 안내 (사용자가 입력하면 진행 중 turn 에 메시지가 주입됨)
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  const focusKeyLabel = isMac ? '⌘ Esc' : 'Ctrl+Esc'
  const idlePlaceholder = `${focusKeyLabel}로 Captain에 포커스하거나 해제하세요`
  const busyActivityPlaceholder = currentActivity
    ? `Captain이 ${currentActivity.label}... · 메시지를 입력하면 즉시 전달됩니다`
    : 'Captain이 작업 중입니다... · 메시지를 입력하면 즉시 전달됩니다'
  const placeholder = isBusy ? busyActivityPlaceholder : idlePlaceholder

  // 글로벌 단축키: Cmd/Ctrl+Esc → 입력창 포커스 토글
  useEffect(() => {
    const onGlobalKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (!(e.metaKey || e.ctrlKey)) return
      const ta = textareaRef.current
      if (!ta) return
      e.preventDefault()
      if (document.activeElement === ta) {
        ta.blur()
      } else {
        ta.focus()
      }
    }
    window.addEventListener('keydown', onGlobalKey)
    return () => window.removeEventListener('keydown', onGlobalKey)
  }, [])
  const [text, setText] = useState('')
  const [showModePopup, setShowModePopup] = useState(false)
  const [showActionMenu, setShowActionMenu] = useState(false)
  const [showAddContext, setShowAddContext] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const [atFilter, setAtFilter] = useState<{ query: string; index: number } | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  // 컨텍스트 사용량 가시화 (80%/90% 임계 색상 변화)
  const ctxPct = Math.max(0, Math.min(100, Math.round(contextUsage?.percentage ?? 0)))
  const ctxLevel = ctxPct >= 90 ? 'critical' : ctxPct >= 80 ? 'warn' : 'normal'
  const ctxTitle = contextUsage
    ? `${contextUsage.usedTokens.toLocaleString()} / ${contextUsage.maxTokens.toLocaleString()} 토큰 (${ctxPct}%)`
    : '컨텍스트 사용량'

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
      if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
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
    // isBusy 여도 전송은 허용 (App.handleSend 가 steer_inject 로 분기)
    if (e.key === 'Enter' && !e.shiftKey && !slashFilter && !showActionMenu && !e.nativeEvent.isComposing) {
      e.preventDefault()
      if (text.trim()) {
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

  /** "+ 컨텍스트 추가" — 멘션 popup 호출 (text 끝에 @ 삽입) */
  const handleInsertMention = useCallback(() => {
    setShowAddContext(false)
    const ta = textareaRef.current
    const cursor = ta?.selectionStart ?? text.length
    const before = text.slice(0, cursor)
    const after = text.slice(cursor)
    // 앞이 공백/없음이 아닐 때만 공백 prefix
    const prefix = before.length > 0 && !/\s$/.test(before) ? ' @' : '@'
    const next = before + prefix + after
    setText(next)
    // 다음 tick 에 mention 자동완성 트리거 (cursor 위치 보장)
    requestAnimationFrame(() => {
      const t = textareaRef.current
      if (!t) return
      const pos = before.length + prefix.length
      t.focus()
      t.setSelectionRange(pos, pos)
      // 빈 query 로 file_search 호출
      sendToHost({ type: 'file_search', payload: { query: '' } })
      setAtFilter({ query: '', index: pos - 1 })
      setMentionIndex(0)
    })
  }, [text])

  /** "+ 파일 업로드" — hidden file input 트리거 (멀티모달 모델일 때만 동작) */
  const handlePickFile = useCallback(() => {
    if (!supportsImages) return
    setShowAddContext(false)
    fileInputRef.current?.click()
  }, [supportsImages])

  /** 선택된 이미지 파일들을 base64 로 변환 + 픽셀 크기 측정하여 pendingAttachments 에 추가 */
  const handleFilesChosen = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''  // 동일 파일 재선택 가능하게 reset
    if (files.length === 0) return
    const MAX_BYTES = 8 * 1024 * 1024  // 8MB per image
    const accepted: Attachment[] = []
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue
      if (f.size > MAX_BYTES) continue
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(r.result as string)
        r.onerror = () => reject(r.error)
        r.readAsDataURL(f)
      })
      // dataUrl: "data:image/png;base64,...."
      const commaIdx = dataUrl.indexOf(',')
      const data = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : ''
      // 픽셀 크기 측정 (실패해도 첨부 자체는 진행)
      const dims = await new Promise<{ w: number; h: number }>((resolve) => {
        const img = new Image()
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
        img.onerror = () => resolve({ w: 0, h: 0 })
        img.src = dataUrl
      })
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
    if (accepted.length > 0) onAttachmentsAdd(accepted)
  }, [onAttachmentsAdd])

  /** 슬래시 명령 공통 마무리 — popup 닫고 입력창 비움 */
  const closeSlash = useCallback(() => {
    onSlashFilterChange(null)
    setShowActionMenu(false)
    setText('')
  }, [onSlashFilterChange])

  /**
   * 컨텍스트 슬래시 → IDE 등록된 action 호출.
   * (IntelliJ 우클릭 메뉴와 동일한 진입점 — ExplainCodeAction 등이 PSI 컨텍스트 수집 후 실행)
   */
  const invokeIdeAction = useCallback((actionId: string) => {
    onSlashFilterChange(null)
    setShowActionMenu(false)
    setText('')
    sendToHost({ type: 'invoke_ide_action', payload: { actionId } })
  }, [onSlashFilterChange])

  const buildCommands = (): SlashCommand[] => [
    // ── 모델 ──
    {
      name: '/model', label: '모델 변경', category: '모델',
      description: currentModel ? `현재: ${currentModel}` : '기본값 (권장)',
      action: () => {
        onToggleModelSelector()
        closeSlash()
        sendToHost({ type: 'model_list', payload: {} })
      }
    },

    // ── 사용자 설정 ──
    {
      name: '/new', label: '새 대화', category: '사용자 설정',
      action: () => { onNewSession(); closeSlash() }
    },
    {
      name: '/history', label: '대화 히스토리', category: '사용자 설정',
      description: '이전 대화 목록',
      action: () => { onToggleHistory(); closeSlash() }
    },
    {
      name: '/settings', label: '설정', category: '사용자 설정',
      action: () => { onOpenSettings(); closeSlash() }
    },

    // ── 컨텍스트 (IDE 등록 액션 호출 — 우클릭 메뉴와 동일 진입점) ──
    {
      name: '/explain', label: '코드 설명', category: '컨텍스트',
      description: 'Explain This Code',
      action: () => invokeIdeAction('omc.explain'),
    },
    {
      name: '/review', label: '코드 리뷰', category: '컨텍스트',
      description: 'Review This Code',
      action: () => invokeIdeAction('omc.review'),
    },
    {
      name: '/impact', label: '변경 영향 분석', category: '컨텍스트',
      description: 'Impact Analysis',
      action: () => invokeIdeAction('omc.impact'),
    },
    {
      name: '/query', label: 'SQL 쿼리 검증', category: '컨텍스트',
      description: 'Query Validation',
      action: () => invokeIdeAction('omc.query'),
    },
    {
      name: '/improve', label: '코드 개선', category: '컨텍스트',
      description: 'Improve This Code',
      action: () => invokeIdeAction('omc.improve'),
    },
    {
      name: '/test', label: '테스트 생성', category: '컨텍스트',
      description: 'Generate Test',
      action: () => invokeIdeAction('omc.test'),
    },
  ]

  return (
    <div className="input-console">
      <div className="input-console-popups">
        {showAddContext && (
          <>
            <div className="slash-popup-overlay" onClick={() => setShowAddContext(false)} />
            <div className="add-context-popup">
              {supportsImages && (
                <div
                  className="add-context-item"
                  onClick={handlePickFile}
                  title="이미지 첨부"
                >
                  <Upload size={14}/> <span>파일 업로드</span>
                </div>
              )}
              <div
                className="add-context-item"
                onClick={handleInsertMention}
                title="파일/심볼 멘션 (@)"
              >
                <AtSign size={14}/> <span>컨텍스트 추가</span>
              </div>
            </div>
          </>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={handleFilesChosen}
        />
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

      {pendingAttachments.length > 0 && (
        <div className="attachment-strip">
          {pendingAttachments.map((att, i) => (
            <div
              key={i}
              className="attachment-card"
              onClick={() => setPreviewAttachment(att)}
              title="클릭하여 확대"
            >
              <img src={att.dataUrl} alt={att.filename ?? 'attachment'} className="attachment-card-thumb" />
              <div className="attachment-card-meta">
                <div className="attachment-card-name">{att.filename ?? '이미지'}</div>
                {att.width && att.height && (
                  <div className="attachment-card-dims">{att.width}×{att.height}</div>
                )}
              </div>
              <button
                type="button"
                className="attachment-card-remove"
                onClick={(e) => { e.stopPropagation(); onAttachmentRemove(i) }}
                title="제거"
                aria-label="첨부 제거"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      {previewAttachment && (
        <ImagePreviewModal attachment={previewAttachment} onClose={() => setPreviewAttachment(null)} />
      )}

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
            {text === '' && !isFocused && (
              <span style={{ color: 'var(--fg-faint)', userSelect: 'none' }}>
                {placeholder}
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
            value={text}
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
              caretColor: 'var(--fg-primary)'
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

            {isBusy && !text.trim() ? (
              // 진행 중 + 입력 비어있음 → 중단 버튼
              <button className="stop-btn" onClick={onAbort} title="중단">
                <Square size={12} fill="white" />
              </button>
            ) : (
              // 그 외 (유휴 또는 진행 중 + 입력 있음) → 전송 버튼
              // 진행 중 + 입력 있음일 때는 steering(메시지 주입)으로 동작
              <button
                className={`send-btn mode-${mode}`}
                disabled={!text.trim()}
                onClick={() => {
                  if (text.trim()) { onSend(text.trim()); setText('') }
                }}
                title={isBusy ? '진행 중인 작업에 메시지 주입 (Enter)' : '전송 (Enter)'}
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
