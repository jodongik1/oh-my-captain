import { z } from 'zod'
import { readFile } from 'fs/promises'
import { registerTool } from './registry.js'
import { markFileRead } from './edit_file.js'
import { resolveSecurePath } from '../utils/path.js'
import type { HostAdapter } from '../host/interface.js'

const argsSchema = z.object({
  path: z.string().describe('읽을 파일의 경로 (프로젝트 루트 상대 또는 절대)'),
  startLine: z.number().optional().describe('읽기 시작 라인 (1-indexed)'),
  endLine: z.number().optional().describe('읽기 종료 라인 (1-indexed, 포함)'),
})

registerTool(
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: `파일의 내용을 라인 번호와 함께 반환합니다. 큰 파일은 startLine/endLine 으로 범위를 지정하세요.

**여러 파일을 한 응답에서 병렬로 호출 가능** — 분석 시 핵심 파일 3~5개를 동시에 읽으세요.
예: 광범위 분석 첫 turn 에 \`read_file('package.json')\`, \`read_file('README.md')\`, \`read_file('tsconfig.json')\` 을 한꺼번에 호출.

grep_tool 로 위치를 먼저 파악한 뒤 startLine/endLine 으로 좁혀 읽으면 토큰 효율이 좋습니다.`,
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '파일 경로' },
          startLine: { type: 'number', description: '시작 라인 (1-indexed, 선택)' },
          endLine: { type: 'number', description: '종료 라인 (1-indexed, 선택)' },
        },
        required: ['path'],
      },
    },
    category: 'readonly',
    concurrencySafe: true,
  },
  async (rawArgs, host: HostAdapter) => {
    const args = argsSchema.parse(rawArgs)
    const absPath = resolveSecurePath(args.path, host.getProjectRoot())
    const content = await readFile(absPath, 'utf-8')

    // edit_file의 stale-write guard에 등록
    markFileRead(absPath, content)

    const lines = content.split('\n')
    if (args.startLine || args.endLine) {
      const start = (args.startLine ?? 1) - 1
      const end = args.endLine ?? lines.length
      const numbered = lines.slice(start, end).map((l, i) => `${start + i + 1}: ${l}`).join('\n')
      return {
        path: args.path,
        content: numbered,
        totalLines: lines.length,
        range: { start: start + 1, end },
      }
    }
    const numbered = lines.map((l, i) => `${i + 1}: ${l}`).join('\n')
    return { path: args.path, content: numbered, totalLines: lines.length }
  }
)
