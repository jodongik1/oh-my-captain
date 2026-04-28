// 타임라인 — entry 배열을 type 별 행 컴포넌트로 디스패치 + 자동 스크롤 관리.
import { useEffect, useRef, useCallback, useState } from 'react'
import type { TimelineEntry, ActivityState, Mode, Attachment } from '../store'
import StreamRow from './timeline/StreamRow'
import ToolRow from './timeline/ToolRow'
import ThinkingRow from './timeline/ThinkingRow'
import ErrorRow from './timeline/ErrorRow'
import BashRow from './timeline/BashRow'
import ApprovalRow from './timeline/ApprovalRow'
import VerifyRow from './timeline/VerifyRow'
import UserRow from './timeline/UserRow'
import InterruptedRow from './timeline/InterruptedRow'
import ActivityIndicator from './ActivityIndicator'
import PlanCompletionAction from './PlanCompletionAction'
import ImagePreviewModal from './ImagePreviewModal'
import { computeDot } from './timeline/dotState'

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

export default function Timeline({
  entries, isBusy, currentActivity, mode,
  onApprovalResponse, onAbort, onExecutePlan, onRetryLastUser,
}: TimelineProps) {
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

          const dot = computeDot(entry)

          return (
            <div key={entry.id} className={`timeline-entry ${entry.type === 'user' ? 'entry-user' : ''}`}>
              {dot.show && <div className={`timeline-dot ${dot.className}`} />}
              <div className="timeline-content">
                <EntryBody
                  entry={entry}
                  onApprovalResponse={onApprovalResponse}
                  onRetryLastUser={onRetryLastUser}
                  onAttachmentClick={setPreviewAttachment}
                />
              </div>
            </div>
          )
        })}
        {/* Timeline 의 마지막에 활동 표시줄 — 다음 응답이 등장할 자리 */}
        <ActivityIndicator activity={currentActivity ?? null} isBusy={!!isBusy} onAbort={onAbort} />
        {/* Plan 모드 + 작업 종료 + 마지막이 계획 응답일 때 → 실행 모드 전환 CTA */}
        {!isBusy && mode === 'plan' && onExecutePlan && lastEntry?.type === 'stream' && lastEntry.content?.trim() && (
          <PlanCompletionAction onExecute={onExecutePlan} />
        )}
      </div>
      <div ref={bottomRef} />
      {previewAttachment && (
        <ImagePreviewModal attachment={previewAttachment} onClose={() => setPreviewAttachment(null)} />
      )}
    </div>
  )
}

interface EntryBodyProps {
  entry: TimelineEntry
  onApprovalResponse?: (requestId: string, approved: boolean) => void
  onRetryLastUser?: () => void
  onAttachmentClick: (att: Attachment) => void
}

function EntryBody({ entry, onApprovalResponse, onRetryLastUser, onAttachmentClick }: EntryBodyProps) {
  switch (entry.type) {
    case 'user':
      return <UserRow content={entry.content} attachments={entry.attachments} onAttachmentClick={onAttachmentClick} />

    case 'stream':
      return <StreamRow content={entry.content ?? ''} syntaxHighlight={true} isStreaming={entry.isStreaming} />

    case 'tool_start': {
      if (entry.tool === 'run_terminal') {
        const args = entry.args as { command?: string } | undefined
        return (
          <BashRow
            command={args?.command ?? ''}
            result={entry.result as { stdout?: string; stderr?: string; exitCode?: number; error?: string } | undefined}
            isActive={entry.isActive}
          />
        )
      }
      return (
        <ToolRow
          tool={entry.tool}
          args={entry.args}
          result={entry.result}
          isActive={entry.isActive}
          startedAt={entry.startedAt}
        />
      )
    }

    case 'thinking':
      return <ThinkingRow durationMs={entry.durationMs ?? 0} content={entry.content} isActive={entry.isActive} />

    case 'verify':
      return entry.verify
        ? <VerifyRow verify={entry.verify} isActive={entry.isActive} durationMs={entry.durationMs} />
        : null

    case 'interrupted':
      return <InterruptedRow onRetry={onRetryLastUser} />

    case 'error':
      return <ErrorRow message={entry.content ?? ''} />

    case 'approval':
      return entry.approval
        ? (
          <ApprovalRow
            approval={entry.approval}
            diff={(entry.approval.details as { diff?: string } | undefined)?.diff}
            onRespond={(approved) => onApprovalResponse?.(entry.approval!.requestId, approved)}
          />
        )
        : null

    default:
      return null
  }
}
