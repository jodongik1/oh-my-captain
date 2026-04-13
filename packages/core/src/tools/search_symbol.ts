import { z } from 'zod'
import { execa } from 'execa'
import { join, isAbsolute } from 'path'
import { registerTool } from './registry.js'
import type { HostAdapter } from '../host/interface.js'

const argsSchema = z.object({
  query: z.string().describe('검색할 심볼 이름 또는 패턴'),
  kind: z.enum(['function', 'class', 'variable', 'interface', 'type', 'all']).optional().default('all').describe('심볼 종류 필터'),
  path: z.string().optional().describe('검색 범위 경로 (기본: 프로젝트 전체)'),
})

registerTool(
  {
    type: 'function',
    function: {
      name: 'search_symbol',
      description: `프로젝트에서 함수, 클래스, 변수 등의 심볼을 검색합니다.
IDE의 심볼 검색과 유사합니다. 함수 정의 위치를 빠르게 찾을 때 유용합니다.`,
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '심볼 이름 또는 패턴' },
          kind: { type: 'string', enum: ['function', 'class', 'variable', 'interface', 'type', 'all'], description: '심볼 종류 (기본: all)' },
          path: { type: 'string', description: '검색 범위 (선택)' },
        },
        required: ['query'],
      },
    },
    category: 'readonly',
    concurrencySafe: true,
  },
  async (rawArgs, host: HostAdapter) => {
    const args = argsSchema.parse(rawArgs)
    const searchPath = args.path
      ? (isAbsolute(args.path) ? args.path : join(host.getProjectRoot(), args.path))
      : host.getProjectRoot()

    // grep 기반 심볼 검색 (언어별 패턴)
    const patterns = buildSymbolPatterns(args.query, args.kind)
    const results: SymbolResult[] = []

    for (const pat of patterns) {
      try {
        const grepResult = await execa('grep', [
          '-rnE', pat.regex,
          '--include=*.ts', '--include=*.tsx', '--include=*.js', '--include=*.jsx',
          '--include=*.kt', '--include=*.java', '--include=*.py', '--include=*.go',
          searchPath,
        ], { reject: false, timeout: 10_000 })

        if (grepResult.stdout) {
          for (const line of grepResult.stdout.split('\n')) {
            const match = line.match(/^(.+?):(\d+):(.*)$/)
            if (match) {
              results.push({
                file: match[1].replace(searchPath + '/', ''),
                line: parseInt(match[2], 10),
                kind: pat.kind,
                content: match[3].trim(),
              })
            }
          }
        }
      } catch { /* skip errors */ }
    }

    return {
      query: args.query,
      kind: args.kind,
      results: results.slice(0, 30),
      totalFound: results.length,
    }
  }
)

interface SymbolResult {
  file: string
  line: number
  kind: string
  content: string
}

function buildSymbolPatterns(query: string, kind: string): { regex: string; kind: string }[] {
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns: { regex: string; kind: string }[] = []

  if (kind === 'all' || kind === 'function') {
    patterns.push(
      { regex: `(function|def|func|fun)\\s+${escaped}`, kind: 'function' },
      { regex: `(const|let|var)\\s+${escaped}\\s*=\\s*(async\\s+)?\\(`, kind: 'function' },
      { regex: `${escaped}\\s*\\(.*\\)\\s*\\{`, kind: 'function' },
    )
  }
  if (kind === 'all' || kind === 'class') {
    patterns.push({ regex: `(class|struct|data class)\\s+${escaped}`, kind: 'class' })
  }
  if (kind === 'all' || kind === 'interface') {
    patterns.push({ regex: `(interface|protocol|trait)\\s+${escaped}`, kind: 'interface' })
  }
  if (kind === 'all' || kind === 'type') {
    patterns.push({ regex: `type\\s+${escaped}`, kind: 'type' })
  }
  if (kind === 'all' || kind === 'variable') {
    patterns.push({ regex: `(const|let|var|val)\\s+${escaped}\\s*[=:]`, kind: 'variable' })
  }

  return patterns
}
