import { useState, useCallback, memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Copy, Check } from 'lucide-react'
import MermaidBlock from './MermaidBlock'

interface StreamRowProps {
  content: string
  syntaxHighlight?: boolean  // true = 코드 액션 응답 (syntax highlighting 활성화)
  /**
   * 응답이 아직 스트리밍 중인지 여부.
   * true 일 때 MermaidBlock 은 미완성 syntax 로 렌더 시도하지 않고 placeholder 만 표시한다 — 깜박임/오류 방지.
   */
  isStreaming?: boolean
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [text])

  return (
    <button className={`code-copy-btn ${copied ? 'copied' : ''}`} onClick={handleCopy} title="Copy code">
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  )
}

function StreamRowImpl({ content, syntaxHighlight, isStreaming }: StreamRowProps) {
  return (
    <div className="stream-row markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={syntaxHighlight ? {
          code({ node, inline, className, children, ...props }: any) {
            const match = /language-(\w+)/.exec(className || '')
            const codeString = String(children).replace(/\n$/, '')

            // Mermaid 다이어그램 — 스트리밍 중에는 미완성 syntax 로 렌더하지 않고 placeholder
            if (!inline && match && match[1] === 'mermaid') {
              return <MermaidBlock code={codeString} isStreaming={isStreaming} />
            }

            if (!inline && match) {
              return (
                <div className="code-block-wrapper">
                  <div className="code-block-header">
                    <span className="code-block-lang">{match[1]}</span>
                    <CopyButton text={codeString} />
                  </div>
                  <SyntaxHighlighter
                    {...props}
                    style={vscDarkPlus as any}
                    language={match[1]}
                    PreTag="div"
                    className="syntax-highlighter-wrapper"
                    customStyle={{ margin: '0', borderRadius: '0 0 6px 6px', background: 'var(--bg-elevated)', fontSize: '12px' }}
                  >
                    {codeString}
                  </SyntaxHighlighter>
                </div>
              )
            }
            return <code {...props} className={className || 'inline-code'}>{children}</code>
          }
        } : undefined}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

/**
 * content / syntaxHighlight / isStreaming 세 prop 만 비교해 memoize.
 * 부모(Timeline)가 다른 사유(예: 입력창 키 입력으로 인한 store 업데이트)로 re-render 될 때
 * ReactMarkdown 의 markdown 재파싱 비용을 차단한다 — 특히 Mermaid 가 포함된 행에서 효과가 크다.
 */
export default memo(StreamRowImpl, (prev, next) =>
  prev.content === next.content &&
  prev.syntaxHighlight === next.syntaxHighlight &&
  prev.isStreaming === next.isStreaming
)
