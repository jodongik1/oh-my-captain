import { z } from 'zod'
import { readFile } from 'fs/promises'
import { join, isAbsolute } from 'path'
import { registerTool } from './registry.js'
import { markFileRead } from './edit_file.js'
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
      description: '파일의 내용을 읽어 반환합니다. 큰 파일은 startLine/endLine으로 범위를 지정하세요.',
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
    const absPath = isAbsolute(args.path)
      ? args.path
      : join(host.getProjectRoot(), args.path)
    const content = await readFile(absPath, 'utf-8')

    // edit_file의 stale-write guard에 등록
    markFileRead(absPath, content)

    if (args.startLine || args.endLine) {
      const lines = content.split('\n')
      const start = (args.startLine ?? 1) - 1
      const end = args.endLine ?? lines.length
      return {
        path: args.path,
        content: lines.slice(start, end).join('\n'),
        totalLines: lines.length,
        range: { start: start + 1, end },
      }
    }
    return { path: args.path, content, totalLines: content.split('\n').length }
  }
)
