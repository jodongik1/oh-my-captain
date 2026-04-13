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
        <button
          onClick={onRetry}
          style={{ marginLeft: 8, background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', textDecoration: 'underline', fontSize: 12 }}
        >
          재시도
        </button>
      )}
    </div>
  )
}
