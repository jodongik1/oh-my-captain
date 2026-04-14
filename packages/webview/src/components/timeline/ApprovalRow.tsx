import type { ApprovalInfo } from '../../store'
import { ShieldCheck, ShieldX, ShieldAlert } from 'lucide-react'
import DiffView from './DiffView'

interface ApprovalRowProps {
  approval: ApprovalInfo
  onRespond: (approved: boolean) => void
  diff?: string
}

const RISK_COLORS: Record<string, string> = {
  high: '#f48771',
  medium: '#cca700',
  low: '#4ec994',
}

const RISK_LABELS: Record<string, string> = {
  high: '위험',
  medium: '주의',
  low: '안전',
}

export default function ApprovalRow({ approval, onRespond, diff }: ApprovalRowProps) {
  const riskColor = RISK_COLORS[approval.risk] ?? RISK_COLORS.medium

  // 승인/거부 완료된 경우 컴팩트 표시
  if (approval.resolved) {
    return (
      <div className={`approval-block resolved ${approval.approved ? 'approved' : 'rejected'}`}>
        <div className="approval-header">
          {approval.approved
            ? <ShieldCheck size={14} style={{ color: '#4ec994' }} />
            : <ShieldX size={14} style={{ color: '#f48771' }} />
          }
          <span className="approval-action">{approval.action}</span>
          <span className="approval-status">
            {approval.approved ? '승인됨' : '거부됨'}
          </span>
        </div>
      </div>
    )
  }

  // 대기 중인 승인 요청
  return (
    <div className="approval-block pending">
      <div className="approval-header">
        <ShieldAlert size={14} style={{ color: riskColor }} />
        <span className="approval-action">{approval.action}</span>
        <span className="approval-risk" style={{ color: riskColor }}>
          {RISK_LABELS[approval.risk] ?? approval.risk}
        </span>
      </div>
      <div className="approval-description">{approval.description}</div>
      {diff && <DiffView diff={diff} />}
      <div className="approval-actions">
        <button className="approval-btn approve" onClick={() => onRespond(true)}>
          승인
        </button>
        <button className="approval-btn reject" onClick={() => onRespond(false)}>
          거부
        </button>
      </div>
    </div>
  )
}
