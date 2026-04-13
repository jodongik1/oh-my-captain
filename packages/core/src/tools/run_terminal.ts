import { z } from 'zod'
import { execa } from 'execa'
import stripAnsi from 'strip-ansi'
import defaultShell from 'default-shell'
import { registerTool } from './registry.js'
import type { HostAdapter } from '../host/interface.js'

const argsSchema = z.object({
  command: z.string().describe('실행할 셸 명령어'),
  timeoutMs: z.number().optional().default(30_000).describe('타임아웃 (ms, 기본 30초)'),
})

const MAX_OUTPUT_CHARS = 50_000  // 출력 최대 길이 (초과 시 앞부분 생략)

registerTool(
  {
    type: 'function',
    function: {
      name: 'run_terminal',
      description: '셸 명령어를 실행하고 stdout/stderr를 반환합니다.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: '실행할 명령어' },
          timeoutMs: { type: 'number', description: '타임아웃 (ms, 기본 30초)' },
        },
        required: ['command'],
      },
    },
  },
  async (rawArgs, host: HostAdapter) => {
    const args = argsSchema.parse(rawArgs)

    const currentMode = host.getMode()
    if (currentMode === 'plan') {
      host.emit('tool_result', {
        tool: 'run_terminal',
        result: { plan: `[Plan] 명령어를 실행하겠습니다: ${args.command}` }
      })
      const approved = await host.requestApproval({
        action: 'run_terminal',
        description: `계획 승인: ${args.command}`,
        risk: 'high',
        details: { command: args.command },
      })
      if (!approved) return { error: '사용자가 거부했습니다.' }
    } else if (currentMode === 'ask') {
      const approved = await host.requestApproval({
        action: 'run_terminal',
        description: `명령어 실행: ${args.command}`,
        risk: 'high',
        details: { command: args.command },
      })
      if (!approved) return { error: '사용자가 거부했습니다.' }
    }
    // Auto mode: 승인 없이 자동 실행

    try {
      const result = await execa(defaultShell, ['-c', args.command], {
        cwd: host.getProjectRoot(),
        timeout: args.timeoutMs,
        reject: false,  // exit code ≠ 0 이어도 throw 안 함
        env: { ...process.env, TERM: 'dumb' },
      })

      let stdout = stripAnsi(result.stdout || '')
      let stderr = stripAnsi(result.stderr || '')

      // 출력이 너무 길면 뒤쪽만 유지
      if (stdout.length > MAX_OUTPUT_CHARS) {
        stdout = '...(truncated)\n' + stdout.slice(-MAX_OUTPUT_CHARS)
      }
      if (stderr.length > MAX_OUTPUT_CHARS) {
        stderr = '...(truncated)\n' + stderr.slice(-MAX_OUTPUT_CHARS)
      }

      return {
        exitCode: result.exitCode,
        stdout,
        stderr,
        timedOut: result.timedOut ?? false,
      }
    } catch (e: any) {
      return { error: e.message, exitCode: -1 }
    }
  }
)
