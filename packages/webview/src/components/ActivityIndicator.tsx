import { useEffect, useState } from 'react'
import type { ActivityState } from '../store'

interface ActivityIndicatorProps {
  activity: ActivityState | null
  isBusy: boolean
  onAbort?: () => void
}

/**
 * 글로벌 활동 표시줄 — Timeline 의 마지막 entry 자리에 렌더되어
 * "다음 응답이 등장할 위치" 에서 깜박이는 dot + 라벨로 진행 상황을 알린다.
 *
 * timeline-entry / timeline-dot / timeline-content 를 그대로 사용해
 * 다른 entry 와 dot 컬럼·들여쓰기·간격이 자동으로 정렬된다.
 *
 * 활동 종류:
 *   - thinking   → "생각 중"
 *   - tool       → "Bash 실행 중", "파일 읽는 중", ...
 *   - preparing  → "준비 중"
 *   - streaming  → "응답 작성 중"
 */
export default function ActivityIndicator({ activity, isBusy, onAbort }: ActivityIndicatorProps) {
  // 1초마다 경과 시간 갱신
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!isBusy || !activity) return
    const id = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [isBusy, activity])

  if (!isBusy || !activity) return null

  const elapsedMs = Date.now() - activity.startedAt
  const seconds = Math.floor(elapsedMs / 1000)
  const elapsedLabel = seconds >= 1 ? `${seconds}s` : ''

  return (
    <div
      className={`timeline-entry timeline-entry-activity activity-${activity.type}`}
      role="status"
      aria-live="polite"
    >
      <div className="timeline-dot dot-active" />
      <div className="timeline-content">
        <div className="activity-inline">
          <span className="activity-label">{activity.label}</span>
          {elapsedLabel && <span className="activity-elapsed">{elapsedLabel}</span>}
          {onAbort && (
            <button className="activity-abort" onClick={onAbort} title="중단 (Esc)">
              esc 로 중단
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
