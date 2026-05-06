// 사용자 입력 `!cmd` 의 직접 실행 핸들러.
//
// 정책:
//   - LLM 호출 없음 — 결과만 timeline 에 표시하고 state.history 에 컨텍스트로 누적.
//   - run_terminal 도구와 동일한 execa 백엔드, ANSI strip, 출력 truncation.
//   - 가드: 빈 명령 / multi-line / hard-block 패턴 / Plan 모드 readonly 만.
//   - tool_start/tool_result 채널을 그대로 재사용 — UI 의 BashRow 가 자동 라우팅.

import { registerHandler } from '../server.js'
import { execa } from 'execa'
import stripAnsi from 'strip-ansi'
import defaultShell from 'default-shell'
import { makeLogger } from '../../utils/logger.js'
import type { CoreState } from './state.js'

const log = makeLogger('shell.ts')

const MAX_OUTPUT_CHARS = 50_000
const TIMEOUT_MS = 30_000

// readonly 명령(첫 토큰 기준) — Plan 모드에서 허용되는 화이트리스트.
// run_terminal 도구의 description 에 명시된 readonly 셋과 일치시켜 동작 일관성 유지.
const READONLY_COMMANDS = new Set([
  'ls', 'find', 'tree', 'cat', 'head', 'tail', 'less', 'file', 'stat', 'wc',
  'grep', 'rg', 'git', 'pwd', 'which', 'env', 'uname', 'date', 'echo',
  'whoami', 'hostname', 'df', 'du', 'ps',
])

// 정말 위험한 패턴 — mode 와 무관하게 차단. 사용자 명시적 입력이라도 오타 한 번에 시스템이 사라지는 것을 막는다.
const HARD_BLOCK_PATTERNS: RegExp[] = [
  /^\s*rm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+)?\/(\s|$)/,   // rm -rf /
  /:\(\)\s*\{\s*:\|\:&\s*\}\s*;\s*:/,               // fork bomb
  /\bmkfs(\.|\s)/,                                  // mkfs / mkfs.xxx
  /\bdd\b[^|]*\bof=\/dev\//,                        // dd of=/dev/sdX
]

function firstToken(cmd: string): string {
  return cmd.trim().split(/[\s;&|]/)[0] ?? ''
}

function isReadonly(cmd: string): boolean {
  return READONLY_COMMANDS.has(firstToken(cmd).toLowerCase())
}

function isHardBlocked(cmd: string): boolean {
  return HARD_BLOCK_PATTERNS.some(p => p.test(cmd))
}

interface ShellOutcome {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

function buildHistoryContent(command: string, r: ShellOutcome): string {
  const parts = [`[Shell] $ ${command}`]
  if (r.stdout) parts.push(r.stdout)
  if (r.stderr) parts.push(`(stderr)\n${r.stderr}`)
  if (r.exitCode !== 0 && r.exitCode !== null) parts.push(`(exit code ${r.exitCode})`)
  if (r.timedOut) parts.push('(timed out)')
  return parts.join('\n')
}

export function registerShellHandlers(state: CoreState) {
  registerHandler('shell_exec', async (msg) => {
    const command = (msg.payload.command || '').trim()
    const host = state.host
    if (!host) {
      log.warn('shell_exec: host 미초기화')
      return
    }

    if (!command) {
      host.emit('error', { message: '빈 명령은 실행할 수 없습니다.', retryable: false })
      return
    }
    if (command.includes('\n')) {
      host.emit('error', { message: '여러 줄 명령은 지원하지 않습니다.', retryable: false })
      return
    }
    if (isHardBlocked(command)) {
      host.emit('error', { message: `위험한 명령이 차단되었습니다: ${command}`, retryable: false })
      return
    }
    const mode = host.getMode()
    if (mode === 'plan' && !isReadonly(command)) {
      host.emit('error', {
        message: `Plan 모드에서는 readonly 명령만 허용됩니다 (${firstToken(command)}). ask/auto 모드로 전환하세요.`,
        retryable: false,
      })
      return
    }

    // tool_start/tool_result 채널을 그대로 사용 — UI 가 BashRow 로 자동 라우팅.
    host.emit('tool_start', { tool: 'run_terminal', args: { command } })

    let outcome: ShellOutcome
    try {
      const result = await execa(defaultShell, ['-c', command], {
        cwd: host.getProjectRoot(),
        timeout: TIMEOUT_MS,
        reject: false,
        env: { ...process.env, TERM: 'dumb' },
      })
      let stdout = stripAnsi(result.stdout || '')
      let stderr = stripAnsi(result.stderr || '')
      if (stdout.length > MAX_OUTPUT_CHARS) stdout = '...(truncated)\n' + stdout.slice(-MAX_OUTPUT_CHARS)
      if (stderr.length > MAX_OUTPUT_CHARS) stderr = '...(truncated)\n' + stderr.slice(-MAX_OUTPUT_CHARS)
      outcome = {
        exitCode: result.exitCode ?? null,
        stdout,
        stderr,
        timedOut: result.timedOut ?? false,
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      log.error(`shell_exec 실행 실패: ${message}`)
      outcome = { exitCode: -1, stdout: '', stderr: message, timedOut: false }
    }

    host.emit('tool_result', { tool: 'run_terminal', result: outcome })
    // tool_result 의 후속 'preparing' activity 를 즉시 정리 — LLM turn 으로 이어지지 않으므로
    // turn_done 으로 SET_BUSY false + currentActivity null 트리거.
    host.emit('turn_done', {})

    // 다음 LLM turn 컨텍스트로 user 메시지 형식으로 누적.
    // 휘발성 — 세션 영속화에는 들어가지 않음 (재개 시에는 복원 안 됨).
    state.history.push({ role: 'user', content: buildHistoryContent(command, outcome) })
    log.debug(`shell_exec 완료 (${command} → exit ${outcome.exitCode})`)
  })
}
