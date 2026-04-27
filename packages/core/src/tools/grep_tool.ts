import { z } from 'zod'
import { execa } from 'execa'
import { join, isAbsolute } from 'path'
import { registerTool } from './registry.js'
import type { HostAdapter } from '../host/interface.js'

const argsSchema = z.object({
  pattern: z.string().describe('검색 패턴 (regex 지원)'),
  path: z.string().optional().describe('검색 경로 (기본: 프로젝트 루트)'),
  include: z.string().optional().describe('파일 패턴 필터 (예: "*.ts")'),
  maxResults: z.number().optional().default(50).describe('최대 결과 수 (기본: 50)'),
  contextLines: z.number().optional().default(2).describe('주변 줄 수 (기본: 2)'),
  caseSensitive: z.boolean().optional().default(true).describe('대소문자 구분 (기본: true)'),
})

registerTool(
  {
    type: 'function',
    function: {
      name: 'grep_tool',
      description: `**코드 위치 검색의 1순위 도구.** 함수·클래스·변수·문자열의 위치를 찾을 때 read_file 보다 먼저 사용하세요.

ripgrep(rg) 우선 사용, 없으면 grep fallback. 정규식·주변 컨텍스트·파일 필터(\`include\`) 지원.

전형적 워크플로우:
1) grep_tool 로 위치 파악
2) 결과의 file/line 을 read_file 의 startLine/endLine 으로 정밀 읽기

여러 키워드를 동시에 찾아야 하면 grep_tool 을 한 응답에서 **여러 번 병렬 호출** 하세요.`,
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: '검색 패턴 (regex)' },
          path: { type: 'string', description: '검색 경로 (선택)' },
          include: { type: 'string', description: '파일 패턴 필터 (예: "*.ts")' },
          maxResults: { type: 'number', description: '최대 결과 수 (기본: 50)' },
          contextLines: { type: 'number', description: '주변 줄 수 (기본: 2)' },
          caseSensitive: { type: 'boolean', description: '대소문자 구분 (기본: true)' },
        },
        required: ['pattern'],
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

    try {
      // ripgrep 우선 시도
      return await searchWithRg(args, searchPath)
    } catch {
      // ripgrep 없으면 grep fallback
      return await searchWithGrep(args, searchPath)
    }
  }
)

async function searchWithRg(args: z.infer<typeof argsSchema>, cwd: string) {
  const rgArgs: string[] = [
    '--json',
    '--max-count', String(args.maxResults),
    '-C', String(args.contextLines),
  ]
  if (!args.caseSensitive) rgArgs.push('-i')
  if (args.include) rgArgs.push('-g', args.include)
  rgArgs.push('--', args.pattern, cwd)

  const result = await execa('rg', rgArgs, { reject: false, timeout: 15_000 })

  if (result.exitCode !== 0 && result.exitCode !== 1) {
    throw new Error('rg failed')
  }

  const matches = parseRgJson(result.stdout, cwd)
  return {
    pattern: args.pattern,
    engine: 'ripgrep',
    matches: matches.slice(0, args.maxResults),
    totalMatches: matches.length,
    truncated: matches.length > args.maxResults,
  }
}

async function searchWithGrep(args: z.infer<typeof argsSchema>, cwd: string) {
  const grepArgs: string[] = [
    '-rn',
    '-C', String(args.contextLines),
    '--max-count=' + String(args.maxResults),
  ]
  if (!args.caseSensitive) grepArgs.push('-i')
  if (args.include) grepArgs.push('--include=' + args.include)
  grepArgs.push('--', args.pattern, cwd)

  const result = await execa('grep', grepArgs, {
    reject: false,
    timeout: 15_000,
    env: { ...process.env, LANG: 'en_US.UTF-8' },
  })

  const matches = parseGrepOutput(result.stdout, cwd)
  return {
    pattern: args.pattern,
    engine: 'grep',
    matches: matches.slice(0, args.maxResults),
    totalMatches: matches.length,
    truncated: matches.length > args.maxResults,
  }
}

interface GrepMatch {
  file: string
  line: number
  content: string
  context?: string[]
}

function parseRgJson(output: string, basePath: string): GrepMatch[] {
  if (!output.trim()) return []
  const matches: GrepMatch[] = []
  for (const line of output.split('\n')) {
    if (!line.trim()) continue
    try {
      const entry = JSON.parse(line)
      if (entry.type === 'match') {
        matches.push({
          file: entry.data.path?.text?.replace(basePath + '/', '') || '',
          line: entry.data.line_number || 0,
          content: entry.data.lines?.text?.trimEnd() || '',
        })
      }
    } catch { /* skip malformed lines */ }
  }
  return matches
}

function parseGrepOutput(output: string, basePath: string): GrepMatch[] {
  if (!output.trim()) return []
  const matches: GrepMatch[] = []
  for (const line of output.split('\n')) {
    const match = line.match(/^(.+?):(\d+):(.*)$/)
    if (match) {
      matches.push({
        file: match[1].replace(basePath + '/', ''),
        line: parseInt(match[2], 10),
        content: match[3].trimEnd(),
      })
    }
  }
  return matches
}
