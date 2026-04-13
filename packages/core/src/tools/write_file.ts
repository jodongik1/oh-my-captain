import { z } from 'zod'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { join, isAbsolute, dirname } from 'path'
import { registerTool } from './registry.js'
import { generateUnifiedDiff } from '../utils/diff.js'
import type { HostAdapter } from '../host/interface.js'

const argsSchema = z.object({
  path: z.string().describe('쓸 파일의 경로'),
  content: z.string().describe('파일에 쓸 전체 내용'),
})

registerTool(
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: '파일을 생성하거나 덮어씁니다. 디렉토리가 없으면 자동 생성합니다.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '파일 경로' },
          content: { type: 'string', description: '파일 내용' },
        },
        required: ['path', 'content'],
      },
    },
    category: 'write',
    concurrencySafe: false,
  },
  async (rawArgs, host: HostAdapter) => {
    const args = argsSchema.parse(rawArgs)
    const absPath = isAbsolute(args.path)
      ? args.path
      : join(host.getProjectRoot(), args.path)

    // 변경 전 스냅샷 저장
    await host.triggerSafetySnapshot(absPath)

    // 변경 전 내용 (diff 생성용)
    let originalContent = ''
    try { originalContent = await readFile(absPath, 'utf-8') } catch { /* 새 파일 */ }

    await mkdir(dirname(absPath), { recursive: true })
    await writeFile(absPath, args.content, 'utf-8')

    const diff = generateUnifiedDiff(args.path, originalContent, args.content)

    return {
      path: args.path,
      linesWritten: args.content.split('\n').length,
      diff,
      isNewFile: originalContent === '',
    }
  }
)
