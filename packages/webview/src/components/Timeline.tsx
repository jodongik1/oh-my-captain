import { useEffect, useRef, useCallback, useState } from 'react'
import type { TimelineEntry, ActivityState, Mode } from '../store'
import StreamRow from './timeline/StreamRow'
import ToolRow from './timeline/ToolRow'
import ThinkingRow from './timeline/ThinkingRow'
import ErrorRow from './timeline/ErrorRow'
import BashRow from './timeline/BashRow'
import ApprovalRow from './timeline/ApprovalRow'
import VerifyRow from './timeline/VerifyRow'
import ActivityIndicator from './ActivityIndicator'
import PlanCompletionAction from './PlanCompletionAction'
import ImagePreviewModal from './ImagePreviewModal'
import type { Attachment } from '../store'

interface TimelineProps {
  entries: TimelineEntry[]
  isBusy?: boolean
  currentActivity?: ActivityState | null
  mode?: Mode
  onApprovalResponse?: (requestId: string, approved: boolean) => void
  onAbort?: () => void
  onExecutePlan?: (mode: 'ask' | 'auto') => void
  onRetryLastUser?: () => void
}

export default function Timeline({ entries, isBusy, currentActivity, mode, onApprovalResponse, onAbort, onExecutePlan, onRetryLastUser }: TimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const isAtBottomRef = useRef(true)
  const [previewAttachment, setPreviewAttachment] = useState<Attachment | null>(null)

  const lastEntry = entries[entries.length - 1]
  const streamingContentLength =
    lastEntry?.type === 'stream' && lastEntry.isStreaming
      ? lastEntry.content?.length ?? 0
      : 0

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const threshold = 60
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= threshold
  }, [])

  useEffect(() => {
    if (!isAtBottomRef.current) return
    const behavior = streamingContentLength > 0 ? 'instant' : 'smooth'
    bottomRef.current?.scrollIntoView({ behavior })
  }, [entries.length, isBusy, streamingContentLength, currentActivity?.label, currentActivity?.startedAt])

  return (
    <div className="timeline" ref={scrollRef} onScroll={handleScroll}>
      <div className="timeline-track-container">
        {entries.map(entry => {
          // tool_result 는 별도 entry 로 렌더 안 함 (tool_start 가 result 까지 표시)
          if (entry.type === 'tool_result') return null

          // ── Dot 상태 결정 ──
          let dotClass = 'dot-inactive'
          let showDot = true

          if (entry.type === 'user') {
            showDot = false
          } else if (entry.type === 'tool_start') {
            if (entry.isActive) {
              dotClass = 'dot-active'
            } else {
              const r = entry.result as any
              if (r && r.__toolSkipped) dotClass = 'dot-inactive'
              else if (entry.tool === 'run_terminal') {
                dotClass = (r && (r.exitCode !== 0 || r.error)) ? 'dot-error' : 'dot-success'
              } else if (r && r.error) dotClass = 'dot-error'
              else dotClass = 'dot-success'
            }
          } else if (entry.type === 'thinking') {
            dotClass = entry.isActive ? 'dot-active' : 'dot-inactive'
          } else if (entry.type === 'verify') {
            if (entry.isActive) dotClass = 'dot-active'
            else dotClass = entry.verify?.passed ? 'dot-success' : 'dot-error'
          } else if (entry.type === 'stream') {
            dotClass = entry.isStreaming ? 'dot-active' : 'dot-inactive'
          } else if (entry.type === 'error') {
            dotClass = 'dot-error'
          } else if (entry.type === 'approval') {
            if (entry.isActive) dotClass = 'dot-active'
            else dotClass = entry.approval?.approved ? 'dot-success' : 'dot-error'
          } else if (entry.type === 'interrupted') {
            dotClass = 'dot-inactive'
          }

          // 사용자 abort 로 중단된 entry 는 회색으로 통일 (위 결정을 덮어씀)
          if (entry.interrupted) dotClass = 'dot-inactive'

          return (
            <div key={entry.id} className={`timeline-entry ${entry.type === 'user' ? 'entry-user' : ''}`}>
              {showDot && (
                <div className={`timeline-dot ${dotClass}`} />
              )}
              <div className="timeline-content">
                {entry.type === 'user' && (
                  <div className="user-message-block">
                    {entry.attachments && entry.attachments.length > 0 && (
                      <div className="user-message-attachments">
                        {entry.attachments.map((att, i) => (
                          <img
                            key={i}
                            src={att.dataUrl}
                            alt={att.filename ?? 'attachment'}
                            className="user-message-thumb"
                            title={att.filename ?? '클릭하여 확대'}
                            onClick={() => setPreviewAttachment(att)}
                          />
                        ))}
                      </div>
                    )}
                    {entry.content && <div className="user-message-text">{entry.content}</div>}
                    <UserMessageCopyButton content={entry.content ?? ''} />
                  </div>
                )}
                {entry.type === 'stream' && (
                  <StreamRow content={entry.content ?? ''} syntaxHighlight={true} />
                )}
                {entry.type === 'tool_start' && entry.tool === 'run_terminal' && (
                  <BashRow
                    command={(entry.args as any)?.command ?? ''}
                    result={entry.result as any}
                    isActive={entry.isActive}
                  />
                )}
                {entry.type === 'tool_start' && entry.tool !== 'run_terminal' && (
                  <ToolRow
                    tool={entry.tool ?? ''}
                    args={entry.args as any}
                    result={entry.result}
                    isActive={entry.isActive}
                    startedAt={entry.startedAt}
                  />
                )}
                {entry.type === 'thinking' && (
                  <ThinkingRow
                    durationMs={entry.durationMs ?? 0}
                    content={entry.content}
                    isActive={entry.isActive}
                  />
                )}
                {entry.type === 'verify' && entry.verify && (
                  <VerifyRow
                    verify={entry.verify}
                    isActive={entry.isActive}
                    durationMs={entry.durationMs}
                  />
                )}
                {entry.type === 'interrupted' && (
                  <div className="interrupted-row">
                    <span className="interrupted-text">사용자가 작업을 중단했습니다.</span>
                    {onRetryLastUser && (
                      <button
                        type="button"
                        className="interrupted-retry"
                        onClick={onRetryLastUser}
                        title="마지막 메시지를 다시 전송"
                      >
                        다시 시도
                      </button>
                    )}
                  </div>
                )}
                {entry.type === 'error' && (
                  <ErrorRow message={entry.content ?? ''} />
                )}
                {entry.type === 'approval' && entry.approval && (
                  <ApprovalRow
                    approval={entry.approval}
                    diff={(entry.approval.details as any)?.diff}
                    onRespond={(approved) => onApprovalResponse?.(entry.approval!.requestId, approved)}
                  />
                )}
              </div>
            </div>
          )
        })}
        {/* Timeline 의 마지막에 활동 표시줄 — 다음 응답이 등장할 자리 */}
        <ActivityIndicator
          activity={currentActivity ?? null}
          isBusy={!!isBusy}
          onAbort={onAbort}
        />
        {/* Plan 모드 + 작업 종료 + 마지막이 계획 응답일 때 → 실행 모드 전환 CTA */}
        {!isBusy && mode === 'plan' && onExecutePlan && (() => {
          const last = entries[entries.length - 1]
          if (last?.type !== 'stream' || !last.content?.trim()) return null
          return <PlanCompletionAction onExecute={onExecutePlan} />
        })()}
      </div>
      <div ref={bottomRef} />
      {previewAttachment && (
        <ImagePreviewModal attachment={previewAttachment} onClose={() => setPreviewAttachment(null)} />
      )}
    </div>
  )
}

function UserMessageCopyButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      className={`user-message-copy-btn ${copied ? 'copied' : ''}`}
      onClick={handleCopy}
      title="내용 복사"
    >
      {copied ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  )
}
