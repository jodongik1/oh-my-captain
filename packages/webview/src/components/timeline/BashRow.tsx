import { sendToHost } from '../../bridge/jcef'

interface BashRowProps {
  command: string
  result?: { stdout?: string; stderr?: string; exitCode?: number; error?: string }
  isActive?: boolean
}

export default function BashRow({ command, result, isActive }: BashRowProps) {
  const hasOutput = result && (result.stdout || result.stderr || result.error)
  const failed = result && (result.exitCode !== 0 || result.error)

  // 줄 수 계산
  const outputText = (result?.stdout || '') + (result?.stderr || '') + (result?.error || '')
  const allLines = outputText ? outputText.split('\n') : []
  const lineCount = allLines.filter(Boolean).length
  const isLongOutput = lineCount > 3

  // 미리보기: 최대 3줄만 표시
  const previewText = allLines.slice(0, 3).join('\n')

  // 명령어 요약 (50자 이하면 그대로, 길면 잘라서 표시)
  const commandSummary = command.length <= 50
    ? command
    : command.slice(0, 47) + '...'

  // OUT 클릭 → 에디터 탭으로 열기
  const handleOutClick = () => {
    if (!hasOutput) return
    sendToHost({
      type: 'open_tool_output',
      payload: {
        title: `Bash tool output`,
        content: outputText
      }
    })
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
          <div className="in-out-row out-row" onClick={handleOutClick}>
            <div className="in-out-label">
              OUT
              {lineCount > 0 && <span className="line-count">{lineCount}</span>}
            </div>
            <div className={`in-out-content output-text ${isLongOutput ? 'output-preview' : 'expanded'}`}>
              {isLongOutput ? (
                <span>{previewText}</span>
              ) : (
                <>
                  {result?.error && <span className="error-text">{result.error}</span>}
                  {result?.stdout && <span>{result.stdout}</span>}
                  {result?.stderr && <span className="error-text">{result.stderr}</span>}
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
