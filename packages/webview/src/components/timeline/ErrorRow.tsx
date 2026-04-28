interface ErrorRowProps {
  message: string
  retryable?: boolean
  onRetry?: () => void
}

export default function ErrorRow({ message, retryable, onRetry }: ErrorRowProps) {
  return (
    <div className="error-row">
      ⚠ {message}
      {retryable && onRetry && (
        <button onClick={onRetry} className="error-row-retry-btn">재시도</button>
      )}
    </div>
  )
}
