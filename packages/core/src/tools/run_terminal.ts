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
      description: `셸 명령어를 실행하고 stdout/stderr 를 반환합니다.

✅ **readonly 명령은 자유롭게 사용 가능** (사용자 승인 불필요, 모든 모드):
- 탐색: ls, find, tree
- 읽기: cat, head, tail, less, file, stat, wc
- 검색: grep, rg
- Git 조회: git status, git log, git diff, git show, git branch, git remote, git blame
- 환경: pwd, which, env, uname, date

광범위 분석 시 \`find . -maxdepth 3 -name "*.ts" -not -path "*/node_modules/*"\` 한 번이 list_dir 10회보다 효율적입니다.
glob_tool 과 함께 첫 turn 에 병렬 호출하세요.

⚠️ 파괴적 명령(rm, git push --force, git reset --hard 등) 은 사용자 승인이 필요합니다.`,
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: '실행할 명령어' },
          timeoutMs: { type: 'number', description: '타임아웃 (ms, 기본 30초)' },
        },
        required: ['command'],
      },
    },
    category: 'destructive',
    concurrencySafe: false,
  },
  async (rawArgs, host: HostAdapter) => {
    const args = argsSchema.parse(rawArgs)

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
