import { useState, type MouseEvent } from 'react'
import { useTimelineActions } from '../../hooks/useTimelineActions'

interface BashRowProps {
  command: string
  result?: { stdout?: string; stderr?: string; exitCode?: number; error?: string }
  isActive?: boolean
}

const PREVIEW_LINES = 6

export default function BashRow({ command, result, isActive }: BashRowProps) {
  const [expanded, setExpanded] = useState(false)
  const { openToolOutput } = useTimelineActions()
  const hasOutput = result && (result.stdout || result.stderr || result.error)
  const failed = result && (result.exitCode !== 0 || result.error)

  // 줄 수 계산
  const outputText = (result?.stdout || '') + (result?.stderr || '') + (result?.error || '')
  const allLines = outputText ? outputText.split('\n') : []
  const lineCount = allLines.filter(Boolean).length
  const isLongOutput = lineCount > PREVIEW_LINES

  // 미리보기: 처음 PREVIEW_LINES 줄만
  const previewText = allLines.slice(0, PREVIEW_LINES).join('\n')

  // 명령어 요약 (60자 이하면 그대로, 길면 잘라서 표시)
  const commandSummary = command.length <= 60
    ? command
    : command.slice(0, 57) + '...'

  // 펼친 상태에서 외부 탭으로 열기 (오른쪽 작은 링크)
  const openInTab = (e: MouseEvent) => {
    e.stopPropagation()
    if (!hasOutput) return
    openToolOutput('Bash tool output', outputText)
  }

  return (
    <div className={`tool-block bash-block ${failed ? 'failed' : ''}`}>
      <div className="tool-header">
        <span className="tool-title">Bash</span>
        <span className="bash-description">{commandSummary}</span>
        {isActive && <span className="status-label active">Running<span className="status-dots" /></span>}
      </div>
      <div className="tool-body">
        <div className="in-out-row">
          <div className="in-out-label">IN</div>
          <div className="in-out-content command-text">
            {command}
          </div>
        </div>
        {hasOutput && (
          <div className="in-out-row out-row" onClick={() => setExpanded(v => !v)}>
            <div className="in-out-label">
              OUT
              {lineCount > 0 && <span className="line-count">{lineCount}</span>}
            </div>
            <div className={`in-out-content output-text ${isLongOutput && !expanded ? 'output-preview' : 'expanded'}`}>
              {isLongOutput && !expanded ? (
                <>
                  <span>{previewText}</span>
                  <span className="tap-to-expand"> + {lineCount - PREVIEW_LINES} lines (클릭하여 펼치기)</span>
                </>
              ) : (
                <>
                  {result?.error && <span className="error-text">{result.error}</span>}
                  {result?.stdout && <span>{result.stdout}</span>}
                  {result?.stderr && <span className="error-text">{result.stderr}</span>}
                  {expanded && isLongOutput && (
                    <span
                      className="tap-to-expand"
                      onClick={openInTab}
                      title="새 에디터 탭으로 열기"
                    >
                      {' '}· 탭으로 열기
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
        )}
        {isActive && !hasOutput && (
          <div className="in-out-row">
            <div className="in-out-label">OUT</div>
            <div className="in-out-content">
              <span className="status-label active">Waiting for output<span className="status-dots" /></span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
