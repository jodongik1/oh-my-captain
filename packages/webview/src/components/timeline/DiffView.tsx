import { useState, useMemo, useEffect } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { parseDiff, Diff, Hunk } from 'react-diff-view'
import 'react-diff-view/style/index.css'

interface DiffViewProps {
  diff: string
  defaultExpanded?: boolean
}

export default function DiffView({ diff, defaultExpanded = false }: DiffViewProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [viewMode, setViewMode] = useState<'unified' | 'split'>('split')

  // 반응형 처리: 가로 폭이 좁으면 자동으로 unified 모드로 전환
  useEffect(() => {
    const handleResize = () => {
      // 600px 미만이면 세로형(unified), 그 이상이면 좌우형(split)
      if (window.innerWidth < 650) {
        setViewMode('unified')
      } else {
        setViewMode('split')
      }
    }
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const files = useMemo(() => {
    if (!diff || typeof diff !== 'string') return []
    
    try {
      // 일부 라이브러리(jsdiff 등)가 생성하는 Index: 나 ==== 헤더 처리
      // react-diff-view는 --- 나 +++ 로 시작하는 표준 형식을 선호함
      let normalizedDiff = diff
      if (diff.includes('--- ') && diff.includes('+++ ')) {
        const startIdx = diff.indexOf('--- ')
        if (startIdx > 0) {
          normalizedDiff = diff.substring(startIdx)
        }
      }
      
      return parseDiff(normalizedDiff)
    } catch (e) {
      console.error('Failed to parse diff content:', { 
        error: e, 
        diffType: typeof diff,
        diffLength: diff?.length,
        diffStart: diff?.substring(0, 100) 
      })
      return []
    }
  }, [diff])

  // 변경 통계 계산
  const stats = useMemo(() => {
    let add = 0
    let del = 0
    files.forEach(f => {
      f.hunks.forEach(h => {
        h.changes.forEach(c => {
          if (c.type === 'insert') add++
          if (c.type === 'delete') del++
        })
      })
    })
    return { add, del }
  }, [files])

  if (files.length === 0) return null

  return (
    <div className="diff-view">
      <div className="diff-header" onClick={() => setExpanded(!expanded)}>
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="diff-stats">
          {stats.add > 0 && <span className="diff-stat-add">+{stats.add}</span>}
          {stats.del > 0 && <span className="diff-stat-del">-{stats.del}</span>}
        </span>
        <span className="diff-toggle-label">
          {expanded ? 'Hide diff' : 'Show diff'}
        </span>
      </div>
      {expanded && (
        <div className="diff-content-wrapper">
          {files.map((file, i) => (
            <Diff key={i} viewType={viewMode} diffType={file.type} hunks={file.hunks}>
              {hunks => hunks.map(hunk => <Hunk key={hunk.content} hunk={hunk} />)}
            </Diff>
          ))}
        </div>
      )}
    </div>
  )
}

