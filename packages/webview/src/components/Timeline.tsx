import { useEffect, useRef, useCallback, useState } from 'react'
import type { TimelineEntry } from '../store'
import StreamRow from './timeline/StreamRow'
import ToolRow from './timeline/ToolRow'
import ThinkingRow from './timeline/ThinkingRow'
import ErrorRow from './timeline/ErrorRow'
import BashRow from './timeline/BashRow'
import ApprovalRow from './timeline/ApprovalRow'

interface TimelineProps {
  entries: TimelineEntry[]
  isBusy?: boolean
  onApprovalResponse?: (requestId: string, approved: boolean) => void
}

export default function Timeline({ entries, isBusy, onApprovalResponse }: TimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const isAtBottomRef = useRef(true)

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
  }, [entries.length, isBusy, streamingContentLength])

  return (
    <div className="timeline" ref={scrollRef} onScroll={handleScroll}>
      <div className="timeline-track-container">
        {entries.map(entry => {
          // ── Dot 상태 결정 ──
          let dotClass = 'dot-inactive'   // 기본: 회색
          
          if (entry.isActive || entry.isStreaming) {
            dotClass = 'dot-active'       // 진행 중: 파란색 깜박임
          } else if (entry.type === 'error') {
            dotClass = 'dot-error'        // 에러: 빨간색
          } else if (entry.type === 'tool_result' || (entry.type === 'tool_start' && !entry.isActive)) {
            dotClass = 'dot-success'      // 완료된 도구: 녹색
          }

          let showDot = true
          if (entry.type === 'tool_result') return null

          if (entry.type === 'user') {
            showDot = false  // 사용자 메시지는 dot 없음
          } else if (entry.type === 'tool_start') {
            if (entry.isActive) {
              dotClass = 'dot-active'  // 진행 중: 깜박이는 파란색
            } else {
              // 완료됨 — 성공/실패 판별
              const r = entry.result as any
              if (entry.tool === 'run_terminal') {
                const failed = r && (r.exitCode !== 0 || r.error)
                dotClass = failed ? 'dot-error' : 'dot-success'
              } else if (r && r.error) {
                dotClass = 'dot-error'
              } else {
                dotClass = 'dot-success'
              }
            }
          } else if (entry.type === 'thinking') {
            dotClass = entry.isActive ? 'dot-active' : 'dot-inactive'
          } else if (entry.type === 'stream') {
            dotClass = entry.isStreaming ? 'dot-active' : 'dot-inactive'
          } else if (entry.type === 'error') {
            dotClass = 'dot-error'
          } else if (entry.type === 'approval') {
            if (entry.isActive) {
              dotClass = 'dot-active'
            } else {
              dotClass = entry.approval?.approved ? 'dot-success' : 'dot-error'
            }
          }

          return (
            <div key={entry.id} className={`timeline-entry ${entry.type === 'user' ? 'entry-user' : ''}`}>
              {showDot && (
                <div className={`timeline-dot ${dotClass}`} />
              )}
              <div className="timeline-content">
                {entry.type === 'user' && (
                  <div className="user-message-block">
                    <div className="user-message-text">{entry.content}</div>
                    <UserMessageCopyButton content={entry.content ?? ''} />
                  </div>
                )}
                {entry.type === 'stream' && (
                  <StreamRow content={entry.content ?? ''} isStreaming={entry.isStreaming} syntaxHighlight={entry.source === 'action'} />
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
      </div>
      <div ref={bottomRef} />
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
