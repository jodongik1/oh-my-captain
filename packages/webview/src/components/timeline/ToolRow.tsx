// 도구 행 디스패처 — TOOL_REGISTRY 의 variant 키로 실제 구현 컴포넌트를 선택한다.
// run_terminal(=bash) 은 Timeline 이 직접 BashRow 로 라우팅하므로 본 디스패처는 처리하지 않는다.

import { useTimelineActions } from '../../hooks/useTimelineActions'
import { getToolMeta } from '../../tools/registry'
import CompactToolRow from './CompactToolRow'
import StandardToolRow from './StandardToolRow'
import ListingRow from './ListingRow'

interface ToolRowProps {
  tool: string
  args: unknown
  result?: unknown
  isActive?: boolean
  startedAt?: number
}

function pickNumber(args: unknown, key: string): number | undefined {
  if (!args || typeof args !== 'object') return undefined
  const v = (args as Record<string, unknown>)[key]
  return typeof v === 'number' ? v : undefined
}

export default function ToolRow({ tool, args, result, isActive, startedAt }: ToolRowProps) {
  const { openInEditor } = useTimelineActions()
  const meta = getToolMeta(tool)

  const onOpenPath = () => {
    const path = meta.extractPath?.(args)
    if (!path) return
    openInEditor(path, pickNumber(args, 'StartLine'))
  }

  switch (meta.variant) {
    case 'compact':
      return (
        <CompactToolRow
          meta={meta}
          args={args}
          result={result}
          isActive={isActive}
          onOpenPath={onOpenPath}
        />
      )
    case 'listing':
      return (
        <ListingRow
          meta={meta}
          args={args}
          result={result}
          isActive={isActive}
          startedAt={startedAt}
          onOpenPath={onOpenPath}
        />
      )
    case 'bash':
      // Timeline 이 BashRow 로 직접 분기하므로 여기로 오는 일은 없다.
      // 그래도 안전망으로 standard 처리.
      return (
        <StandardToolRow
          meta={meta}
          args={args}
          result={result}
          isActive={isActive}
          startedAt={startedAt}
          onOpenPath={onOpenPath}
        />
      )
    case 'standard':
    default:
      return (
        <StandardToolRow
          meta={meta}
          args={args}
          result={result}
          isActive={isActive}
          startedAt={startedAt}
          onOpenPath={onOpenPath}
        />
      )
  }
}
