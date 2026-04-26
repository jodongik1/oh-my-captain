import { useEffect, useRef, useState } from 'react'
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
}

export default function MermaidBlock({ code }: MermaidBlockProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [svg, setSvg] = useState<string>('')
  const [error, setError] = useState<string>('')

  useEffect(() => {
    const id = `mermaid-${Date.now()}-${mermaidIdCounter++}`

    const renderDiagram = async () => {
      try {
        const { svg: renderedSvg } = await mermaid.render(id, code)
        setSvg(renderedSvg)
        setError('')
      } catch (e: any) {
        console.error('[MermaidBlock] Render failed:', e)
        setError(e?.message || 'Mermaid 렌더링 실패')
        // mermaid가 실패 시 생성한 임시 엘리먼트 제거
        const el = document.getElementById(id)
        if (el) el.remove()
      }
    }

    renderDiagram()
  }, [code])

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
