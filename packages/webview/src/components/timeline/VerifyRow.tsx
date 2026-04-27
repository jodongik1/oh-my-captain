import { useState } from 'react'
import { CheckCircle2, AlertCircle } from 'lucide-react'
import type { VerifyInfo } from '../../store'

interface VerifyRowProps {
  verify: VerifyInfo
  isActive?: boolean
  durationMs?: number
}

/**
 * 자동 검증 결과 행. 통과 시 한 줄 요약, 실패 시 명령 + 출력 펼침 가능.
 * timeline-entry 안에 들어가므로 dot 은 부모 Timeline 이 그린다.
 */
export default function VerifyRow({ verify, isActive, durationMs }: VerifyRowProps) {
  const [expanded, setExpanded] = useState(!verify.passed)
  const seconds = durationMs ? Math.round(durationMs / 100) / 10 : 0

  if (isActive) {
    return (
      <div className="verify-row verify-active">
        <span className="verify-label">코드 검증 중<span className="status-dots" /></span>
      </div>
    )
  }

  const Icon = verify.passed ? CheckCircle2 : AlertCircle

  return (
    <div className={`verify-row ${verify.passed ? 'verify-pass' : 'verify-fail'}`}>
      <div className="verify-header" onClick={() => verify.output && setExpanded(v => !v)}>
        <Icon size={13} className="verify-icon" />
        <span className="verify-label">
          {verify.passed ? '검증 통과' : '검증 실패'}
          {verify.command && verify.command !== 'auto' && (
            <span className="verify-cmd"> · {verify.command}</span>
          )}
        </span>
        {seconds > 0 && <span className="verify-elapsed">{seconds}s</span>}
        {!verify.passed && verify.output && (
          <span className="verify-toggle">{expanded ? '▾' : '▸'}</span>
        )}
      </div>
      {expanded && verify.output && (
        <pre className="verify-output">{verify.output}</pre>
      )}
    </div>
  )
}
