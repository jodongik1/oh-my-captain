import { memo, useEffect, useRef, useState } from 'react'
import mermaid from 'mermaid'

// Mermaid 초기화 (한 번만)
mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  themeVariables: {
    darkMode: true,
    background: '#1a1a1a',
    primaryColor: '#3b82f6',
    primaryTextColor: '#e0e0e0',
    primaryBorderColor: '#3b82f6',
    lineColor: '#555',
    secondaryColor: '#2e2e2e',
    tertiaryColor: '#232323',
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    fontSize: '13px',
  },
  securityLevel: 'loose',
  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
})

let mermaidIdCounter = 0

interface MermaidBlockProps {
  code: string
  /**
   * true 면 응답이 아직 스트리밍 중 — 미완성 다이어그램 코드로 mermaid.render() 호출하지 않는다.
   * (깜박임/렌더 오류 박스 깜박임 방지)
   * false 또는 undefined 면 정상 렌더.
   */
  isStreaming?: boolean
}

/** 렌더 디바운스 — 스트림 종료 직후나 빠른 prop 변동 시 중복 호출 억제 */
const RENDER_DEBOUNCE_MS = 120

function MermaidBlockImpl({ code, isStreaming }: MermaidBlockProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [svg, setSvg] = useState<string>('')
  const [error, setError] = useState<string>('')
  /** 마지막으로 실제 렌더한 source — 같으면 다시 안 그림 */
  const lastRenderedRef = useRef<string>('')

  useEffect(() => {
    // 스트리밍 중에는 절대 렌더 시도하지 않는다 (미완성 syntax → 매 토큰 오류 → 깜박임 원인)
    if (isStreaming) return
    // 이전과 동일한 코드면 다시 그릴 필요 없음
    if (code === lastRenderedRef.current && (svg || error)) return

    let cancelled = false
    const id = `mermaid-${Date.now()}-${mermaidIdCounter++}`

    const handle = window.setTimeout(async () => {
      try {
        const { svg: renderedSvg } = await mermaid.render(id, code)
        if (cancelled) return
        lastRenderedRef.current = code
        setSvg(renderedSvg)
        setError('')
      } catch (e: any) {
        if (cancelled) return
        console.error('[MermaidBlock] Render failed:', e)
        lastRenderedRef.current = code
        setError(e?.message || 'Mermaid 렌더링 실패')
        // mermaid 가 실패 시 생성한 임시 엘리먼트 제거
        const el = document.getElementById(id)
        if (el) el.remove()
      }
    }, RENDER_DEBOUNCE_MS)

    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [code, isStreaming])

  // 스트리밍 중: 코드를 plain text 로 보여주되 렌더 시도는 안 함
  if (isStreaming) {
    return (
      <div className="mermaid-loading">
        <div className="mermaid-loading-header">
          <span className="busy-indicator" /> 다이어그램 작성 중…
        </div>
        <pre className="mermaid-streaming-preview">{code}</pre>
      </div>
    )
  }

  if (error) {
    return (
      <div className="mermaid-error">
        <div className="mermaid-error-label">⚠ Mermaid 렌더링 오류</div>
        <pre className="mermaid-error-code">{code}</pre>
      </div>
    )
  }

  if (!svg) {
    return (
      <div className="mermaid-loading">
        <span className="busy-indicator" /> 다이어그램 렌더링 중...
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="mermaid-container"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

/**
 * code 와 isStreaming 두 prop 만 비교 — 부모 리렌더에 영향받지 않도록 memo 처리.
 * 스트리밍 중에는 매 토큰마다 부모가 리렌더되지만, 같은 code+isStreaming 조합이면 MermaidBlock 자체는 리렌더되지 않는다.
 */
export default memo(MermaidBlockImpl, (prev, next) =>
  prev.code === next.code && prev.isStreaming === next.isStreaming
)
