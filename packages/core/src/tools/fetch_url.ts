import { z } from 'zod'
import { registerTool } from './registry.js'
import type { HostAdapter } from '../host/interface.js'

const argsSchema = z.object({
  url: z.string().url().describe('가져올 URL'),
  maxLength: z.number().optional().default(10_000).describe('최대 콘텐츠 길이 (기본: 10000)'),
})

registerTool(
  {
    type: 'function',
    function: {
      name: 'fetch_url',
      description: `URL의 텍스트 콘텐츠를 가져옵니다.
API 문서, 라이브러리 레퍼런스 등을 참조할 때 유용합니다.
HTML은 텍스트로 변환되며, 큰 페이지는 maxLength로 잘립니다.`,
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL' },
          maxLength: { type: 'number', description: '최대 콘텐츠 길이 (기본: 10000)' },
        },
        required: ['url'],
      },
    },
    category: 'readonly',
    concurrencySafe: true,
  },
  async (rawArgs, _host: HostAdapter) => {
    const args = argsSchema.parse(rawArgs)

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 15_000)

      const response = await fetch(args.url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'OhMyCaptain/1.0 (AI Coding Agent)',
          'Accept': 'text/html, text/plain, application/json, */*',
        },
      })
      clearTimeout(timeout)

      if (!response.ok) {
        return { error: `HTTP ${response.status}: ${response.statusText}`, url: args.url }
      }

      const contentType = response.headers.get('content-type') || ''
      let text = await response.text()

      // HTML → 텍스트 변환 (간단한 태그 제거)
      if (contentType.includes('text/html')) {
        text = stripHtml(text)
      }

      // 길이 제한
      const truncated = text.length > args.maxLength
      if (truncated) {
        text = text.slice(0, args.maxLength) + '\n...(truncated)'
      }

      return {
        url: args.url,
        contentType: contentType.split(';')[0].trim(),
        content: text,
        length: text.length,
        truncated,
      }
    } catch (e: any) {
      return { error: `URL 요청 실패: ${e.message}`, url: args.url }
    }
  }
)

/** 간단한 HTML → 텍스트 변환 */
function stripHtml(html: string): string {
  return html
    // script, style 태그 제거
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    // 줄바꿈 태그
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    // 모든 태그 제거
    .replace(/<[^>]+>/g, '')
    // HTML 엔터티
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // 연속 빈줄 정리
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
