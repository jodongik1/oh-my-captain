import { useState } from 'react'
import { CheckCircle2, AlertCircle, AlertTriangle } from 'lucide-react'
import type { VerifyInfo } from '../../store'

interface VerifyRowProps {
  verify: VerifyInfo
  isActive?: boolean
  durationMs?: number
}

/**
 * 자동 검증 결과 행. 통과 / 코드 실패 / 환경 에러 3 상태.
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

  const isEnvFailure = !verify.passed && verify.failureKind === 'env'
  const stateClass = verify.passed ? 'verify-pass' : isEnvFailure ? 'verify-env' : 'verify-fail'
  const Icon = verify.passed ? CheckCircle2 : isEnvFailure ? AlertTriangle : AlertCircle
  const label = verify.passed
    ? '검증 통과'
    : isEnvFailure
      ? '검증 건너뜀 — 환경 에러'
      : '검증 실패'

  return (
    <div className={`verify-row ${stateClass}`}>
      <div className="verify-header" onClick={() => verify.output && setExpanded(v => !v)}>
        <Icon size={13} className="verify-icon" />
        <span className="verify-label">
          {label}
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
