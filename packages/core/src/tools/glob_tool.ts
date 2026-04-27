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
      description: `**프로젝트 구조/파일 탐색의 1차 도구.** 광범위 분석 시 가장 먼저 사용하세요.

glob 패턴으로 한 번에 다수 파일을 찾습니다. .gitignore 와 node_modules/.git 자동 제외.
list_dir 로 트리를 한 단계씩 내려가는 것보다 훨씬 효율적입니다.

자주 쓰는 패턴:
- \`**/*.{ts,tsx,js,jsx}\` — 모든 JS/TS 파일
- \`**/*.{kt,java,py,go,rs}\` — 다른 언어 소스
- \`**/package.json\` / \`**/build.gradle*\` / \`**/pom.xml\` — 빌드 메타파일
- \`**/test/**/*.{ts,js}\` 또는 \`**/*.test.ts\` — 테스트 파일
- \`**/README*\` — 문서

광범위 코드베이스 분석 첫 turn 에 \`run_terminal(find ...)\`, \`read_file(핵심 메타)\` 와 **병렬로 호출** 하세요.`,
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
