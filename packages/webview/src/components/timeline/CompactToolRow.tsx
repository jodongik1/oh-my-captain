// 한 줄짜리 컴팩트 도구 행 (현재 read_file 전용).
// "Reading foo.ts" / "Read foo.ts" 처럼 진행 상태 + 파일명만 보여주고 펼치기는 제공하지 않는다.

import type { ToolMeta } from '../../tools/registry'

interface Props {
  meta: ToolMeta
  args: unknown
  result?: unknown
  isActive?: boolean
  onOpenPath: () => void
}

function basenameOf(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

export default function CompactToolRow({ meta, args, result, isActive, onOpenPath }: Props) {
  const path = meta.extractPath?.(args) ?? null
  const file = path ? basenameOf(path) : ''
  const wasSkipped = !!(result && typeof result === 'object' && (result as { __toolSkipped?: boolean }).__toolSkipped)

  // read_file 의 진행 라벨은 "Reading", 완료는 "Read".
  // 일반화하려면 meta 에 active/done 라벨을 둘 수 있지만 현재 변종은 read_file 뿐이므로 inline 분기.
  const label = wasSkipped ? 'Skipped' : isActive ? `${meta.displayName}ing` : meta.displayName

  return (
    <div className={`tool-compact tool-${meta.cssClass} ${wasSkipped ? 'skipped' : ''}`}>
      <span className="tool-compact-title">{label} </span>
      <span
        className="tool-compact-file"
        onClick={onOpenPath}
        title={path ? '클릭하여 에디터에서 열기' : ''}
      >
        {file}
      </span>
      {isActive && <span className="status-dots" />}
    </div>
  )
}
