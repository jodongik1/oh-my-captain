import { z } from 'zod'
import { globby } from 'globby'
import { join, isAbsolute } from 'path'
import { registerTool } from './registry.js'
import type { HostAdapter } from '../host/interface.js'

const argsSchema = z.object({
  pattern: z.string().describe('glob 패턴 (예: "**/*.ts", "src/**/*.{ts,tsx}")'),
  cwd: z.string().optional().describe('검색 시작 디렉토리 (기본: 프로젝트 루트)'),
  maxResults: z.number().optional().default(100).describe('최대 결과 수 (기본: 100)'),
})

registerTool(
  {
    type: 'function',
    function: {
      name: 'glob_tool',
      description: `glob 패턴으로 프로젝트 내 파일을 탐색합니다.
.gitignore를 자동으로 존중합니다.
예시: "**/*.ts" (모든 TS 파일), "src/**/test*.ts" (src 아래 테스트 파일)`,
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'glob 패턴' },
          cwd: { type: 'string', description: '검색 시작 디렉토리 (선택)' },
          maxResults: { type: 'number', description: '최대 결과 수 (기본: 100)' },
        },
        required: ['pattern'],
      },
    },
    category: 'readonly',
    concurrencySafe: true,
  },
  async (rawArgs, host: HostAdapter) => {
    const args = argsSchema.parse(rawArgs)
    const cwd = args.cwd
      ? (isAbsolute(args.cwd) ? args.cwd : join(host.getProjectRoot(), args.cwd))
      : host.getProjectRoot()

    const files = await globby(args.pattern, {
      cwd,
      gitignore: true,
      ignore: ['**/node_modules/**', '**/.git/**'],
      onlyFiles: true,
    })

    const limited = files.slice(0, args.maxResults)
    return {
      pattern: args.pattern,
      cwd: args.cwd || '.',
      files: limited,
      totalFound: files.length,
      truncated: files.length > args.maxResults,
    }
  }
)
