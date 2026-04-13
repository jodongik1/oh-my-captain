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
  },
  async (rawArgs, host: HostAdapter) => {
    const args = argsSchema.parse(rawArgs)
    const absPath = isAbsolute(args.path)
      ? args.path
      : join(host.getProjectRoot(), args.path)

    const currentMode = host.getMode()
    if (currentMode === 'plan') {
      // Plan mode: 실행하지 않고 계획 설명만 반환
      return {
        planned: true,
        action: 'write_file',
        path: args.path,
        lineCount: args.content.split('\n').length,
        summary: `[Plan] 파일을 수정하겠습니다: ${args.path} (${args.content.split('\n').length}줄)`,
      }
    } else if (currentMode === 'ask') {
      // Ask mode: diff 생성 + 승인 요청
      let originalContent = ''
      try { originalContent = await readFile(absPath, 'utf-8') } catch { /* 새 파일 */ }
      const diff = generateUnifiedDiff(args.path, originalContent, args.content)

      const approved = await host.requestApproval({
        action: 'write_file',
        description: `파일 쓰기: ${args.path} (${args.content.split('\n').length}줄)`,
        risk: 'medium',
        details: { path: args.path, lineCount: args.content.split('\n').length, diff },
      })
      if (!approved) return { error: '사용자가 거부했습니다.' }
    }
    // Auto mode: 승인 없이 자동 실행

    // 변경 전 스냅샷 저장
    await host.triggerSafetySnapshot(absPath)

    await mkdir(dirname(absPath), { recursive: true })
    await writeFile(absPath, args.content, 'utf-8')
    return { path: args.path, linesWritten: args.content.split('\n').length }
  }
)
