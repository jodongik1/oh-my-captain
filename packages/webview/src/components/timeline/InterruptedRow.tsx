// 사용자 abort 로 중단된 turn 의 표시 — '다시 시도' 버튼 옵션.
interface Props {
  onRetry?: () => void
}

export default function InterruptedRow({ onRetry }: Props) {
  return (
    <div className="interrupted-row">
      <span className="interrupted-text">사용자가 작업을 중단했습니다.</span>
      {onRetry && (
        <button
          type="button"
          className="interrupted-retry"
          onClick={onRetry}
          title="마지막 메시지를 다시 전송"
        >
          다시 시도
        </button>
      )}
    </div>
  )
}
