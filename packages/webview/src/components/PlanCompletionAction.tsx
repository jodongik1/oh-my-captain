import { FileText, Code } from 'lucide-react'

interface PlanCompletionActionProps {
  onExecute: (mode: 'ask' | 'auto') => void
}

/**
 * Plan 모드의 마지막 응답(=계획) 다음에 등장하는 CTA.
 * 사용자가 한 번의 클릭으로 모드를 전환하고 "위 계획대로 실행" 메시지를 자동 주입.
 *
 * - 편집 전 확인(Ask): 변경 사항마다 사용자 승인을 받으며 실행
 * - 자동 편집(Auto): 사용자 승인 없이 즉시 실행 (파괴적 명령 포함)
 */
export default function PlanCompletionAction({ onExecute }: PlanCompletionActionProps) {
  return (
    <div className="timeline-entry plan-completion-entry">
      <div className="timeline-dot dot-success" />
      <div className="timeline-content">
        <div className="plan-completion-card">
          <div className="plan-completion-text">
            계획이 준비되었습니다. 어떤 모드로 실행할까요?
          </div>
          <div className="plan-completion-actions">
            <button
              type="button"
              className="plan-cta-btn plan-cta-ask"
              onClick={() => onExecute('ask')}
              title="각 변경마다 승인을 받으며 실행"
            >
              <FileText size={13} />
              <span>편집 전 확인</span>
            </button>
            <button
              type="button"
              className="plan-cta-btn plan-cta-auto"
              onClick={() => onExecute('auto')}
              title="승인 없이 즉시 실행 (파괴적 명령 포함)"
            >
              <Code size={13} />
              <span>자동 편집</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
