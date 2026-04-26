import { useState, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Copy, Check } from 'lucide-react'
import MermaidBlock from './MermaidBlock'

interface StreamRowProps {
  content: string
  isStreaming?: boolean
  syntaxHighlight?: boolean  // true = 코드 액션 응답 (syntax highlighting 활성화)
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

export default function StreamRow({ content, isStreaming, syntaxHighlight }: StreamRowProps) {
  return (
    <div className="stream-row markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={syntaxHighlight ? {
          code({ node, inline, className, children, ...props }: any) {
            const match = /language-(\w+)/.exec(className || '')
            const codeString = String(children).replace(/\n$/, '')

            // Mermaid 다이어그램 렌더링
            if (!inline && match && match[1] === 'mermaid') {
              return <MermaidBlock code={codeString} />
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
      {isStreaming && <span className="streaming-cursor">▍</span>}
    </div>
  )
}
