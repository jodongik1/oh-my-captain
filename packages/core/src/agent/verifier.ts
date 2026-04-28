/**
 * Auto Verifier — 코드 변경 후 자동으로 빌드/타입체크/테스트를 실행해
 * 결과를 LLM 에 피드백하는 모듈.
 *
 * 설계 원칙:
 * - IDE 무관 (Node.js 파일시스템 + 셸 명령만 사용)
 * - 프로젝트 타입을 heuristic 으로 감지 후 가장 빠른 검증 명령 선택
 * - timeout, abort signal, 출력 길이 제한으로 사용자 경험 보호
 *
 * 향후 확장:
 * - .captain/hooks.json 의 PostToolUse hook (Phase 3)
 * - HostAdapter.getDiagnostics 의 IDE-agnostic 진단 결합 (Phase 5)
 */

import { execa } from 'execa'
import defaultShell from 'default-shell'
import stripAnsi from 'strip-ansi'
import { readFile, stat } from 'fs/promises'
import { join } from 'path'
import { makeLogger } from '../utils/logger.js'

const log = makeLogger('verifier.ts')

const MAX_OUTPUT_CHARS = 8_000   // LLM 에 피드백할 출력 최대 길이
const DEFAULT_TIMEOUT_MS = 90_000 // verify 는 빌드 가능성이 있어 90초까지 허용

export interface VerifyResult {
  /** 사용자/LLM 에게 보여줄 명령 라벨 (예: "tsc --noEmit") */
  command: string
  /** 프로젝트 타입 식별 (typescript, python, kotlin, go, ...) */
  projectKind: string
  /** 명령 실행 종료 코드 */
  exitCode: number
  /** 통과 여부 */
  passed: boolean
  /** 잘려진 stdout+stderr */
  output: string
  /** 실행 시간 (ms) */
  durationMs: number
  /** timeout 으로 종료되었는지 */
  timedOut: boolean
  /**
   * 실패 원인 분류 (passed=false 일 때만 의미 있음).
   * - 'code': 코드 변경 결과의 빌드/타입/테스트 실패 (LLM 이 고쳐야 함)
   * - 'env':  사용자의 빌드 환경 문제 (pom 손상, 도구 미설치, 네트워크 등 — LLM 이 고치지 말 것)
   */
  failureKind?: 'code' | 'env'
}

/** 환경(빌드 도구·POM·네트워크 등) 문제로 인한 실패를 식별하는 패턴들. */
const ENV_FAILURE_PATTERNS: RegExp[] = [
  /non[- ]?parseable\s+pom/i,
  /unable\s+to\s+parse\s+pom/i,
  /unrecognised\s+tag/i,
  /could\s+not\s+(?:find|read|load)\s+build\.gradle/i,
  /command\s+not\s+found/i,
  /\benoent\b.*\bspawn\b/i,
  /no\s+such\s+file\s+or\s+directory.*\b(mvn|gradle|gradlew|tsc|ruff|cargo|go)\b/i,
  /\bjava[._-]?home\b/i,
  /could\s+not\s+transfer\s+artifact/i,
  /could\s+not\s+resolve\s+dependencies/i,
  /connection\s+refused/i,
  /permission\s+denied.*\bgradlew\b/i,
  /verify\s+실행\s+실패/, // runAutoVerify 내부 catch 블록 메시지
]

export function classifyFailure(output: string): 'code' | 'env' {
  for (const re of ENV_FAILURE_PATTERNS) {
    if (re.test(output)) return 'env'
  }
  return 'code'
}

interface VerifyCommand {
  projectKind: string
  command: string
}

/**
 * 프로젝트 타입별 검증 전략 인터페이스.
 * detect() 가 { projectKind, command } 를 반환하면 매칭 성공, null 이면 다음 전략으로.
 * 새 언어/빌드 시스템 추가 시 새 전략 객체만 추가하면 됨 (OCP).
 */
interface VerifyStrategy {
  detect(projectRoot: string): Promise<VerifyCommand | null>
}

/** 파일 존재 확인 (디렉토리 포함) */
async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true } catch { return false }
}

/** package.json 의 scripts 에서 우선 실행할 수 있는 검증 스크립트 추출 */
async function findNpmVerifyScript(projectRoot: string): Promise<string | null> {
  try {
    const raw = await readFile(join(projectRoot, 'package.json'), 'utf-8')
    const pkg = JSON.parse(raw)
    const scripts = (pkg.scripts ?? {}) as Record<string, string>
    // 우선순위: typecheck > type-check > check > build (빠른 것부터)
    const candidates = ['typecheck', 'type-check', 'check', 'lint', 'build']
    for (const name of candidates) {
      if (scripts[name]) return name
    }
  } catch {
    /* not a node project or invalid json */
  }
  return null
}

const nodeStrategy: VerifyStrategy = {
  async detect(root) {
    if (!(await exists(join(root, 'package.json')))) return null
    const script = await findNpmVerifyScript(root)
    if (script) {
      const useP = await exists(join(root, 'pnpm-lock.yaml'))
      const cmd = useP ? `pnpm run ${script}` : `npm run ${script}`
      return { projectKind: 'node', command: cmd }
    }
    if (await exists(join(root, 'tsconfig.json'))) {
      return { projectKind: 'typescript', command: 'npx --no-install tsc --noEmit' }
    }
    return null
  },
}

const standaloneTypescriptStrategy: VerifyStrategy = {
  async detect(root) {
    if (await exists(join(root, 'package.json'))) return null  // nodeStrategy 가 우선
    if (!(await exists(join(root, 'tsconfig.json')))) return null
    return { projectKind: 'typescript', command: 'npx --no-install tsc --noEmit' }
  },
}

const pythonStrategy: VerifyStrategy = {
  async detect(root) {
    const hasPyProject = await exists(join(root, 'pyproject.toml'))
    const hasReq = await exists(join(root, 'requirements.txt'))
    if (!hasPyProject && !hasReq) return null
    return { projectKind: 'python', command: 'ruff check . || python -m mypy .' }
  },
}

const gradleStrategy: VerifyStrategy = {
  async detect(root) {
    const hasKts = await exists(join(root, 'build.gradle.kts'))
    const hasGroovy = await exists(join(root, 'build.gradle'))
    if (!hasKts && !hasGroovy) return null
    return {
      projectKind: 'gradle',
      command: './gradlew --quiet compileKotlin compileJava 2>/dev/null || ./gradlew --quiet build -x test',
    }
  },
}

const mavenStrategy: VerifyStrategy = {
  async detect(root) {
    if (!(await exists(join(root, 'pom.xml')))) return null
    return { projectKind: 'maven', command: 'mvn -q compile' }
  },
}

const goStrategy: VerifyStrategy = {
  async detect(root) {
    if (!(await exists(join(root, 'go.mod')))) return null
    return { projectKind: 'go', command: 'go build ./...' }
  },
}

const rustStrategy: VerifyStrategy = {
  async detect(root) {
    if (!(await exists(join(root, 'Cargo.toml')))) return null
    return { projectKind: 'rust', command: 'cargo check --quiet' }
  },
}

/**
 * 우선순위 순으로 평가되는 전략 목록.
 * 첫 매치가 채택되며, 새 언어 추가는 이 배열에 push 하는 것만으로 충분하다.
 */
const VERIFY_STRATEGIES: VerifyStrategy[] = [
  nodeStrategy,
  standaloneTypescriptStrategy,
  pythonStrategy,
  gradleStrategy,
  mavenStrategy,
  goStrategy,
  rustStrategy,
]

async function detectVerifyCommand(projectRoot: string): Promise<VerifyCommand | null> {
  for (const strategy of VERIFY_STRATEGIES) {
    const result = await strategy.detect(projectRoot)
    if (result) return result
  }
  return null
}

/**
 * 자동 검증 실행. 프로젝트 타입을 감지하고 적절한 명령을 실행한다.
 * 감지 실패 시 null 반환 — 호출자는 이를 "검증 스킵" 으로 처리.
 */
export async function runAutoVerify(
  projectRoot: string,
  signal?: AbortSignal,
  options?: { timeoutMs?: number }
): Promise<VerifyResult | null> {
  const detected = await detectVerifyCommand(projectRoot)
  if (!detected) {
    log.debug('verify 명령 감지 실패 — 검증 스킵')
    return null
  }

  const startedAt = Date.now()
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS

  try {
    const result = await execa(defaultShell, ['-c', detected.command], {
      cwd: projectRoot,
      timeout: timeoutMs,
      reject: false,
      env: { ...process.env, TERM: 'dumb', CI: '1' },
      cancelSignal: signal,
    })

    const stdout = stripAnsi(result.stdout || '')
    const stderr = stripAnsi(result.stderr || '')
    let output = [stdout, stderr].filter(Boolean).join('\n').trim()
    if (output.length > MAX_OUTPUT_CHARS) {
      // 컴파일 오류는 보통 시작/끝 부분에 핵심 메시지가 있음 → 양 끝 보존
      const head = output.slice(0, MAX_OUTPUT_CHARS / 2)
      const tail = output.slice(-MAX_OUTPUT_CHARS / 2)
      output = `${head}\n\n...(중략)...\n\n${tail}`
    }

    const passed = result.exitCode === 0 && !result.timedOut
    return {
      command: detected.command,
      projectKind: detected.projectKind,
      exitCode: result.exitCode ?? -1,
      passed,
      output,
      durationMs: Date.now() - startedAt,
      timedOut: result.timedOut ?? false,
      failureKind: passed ? undefined : classifyFailure(output),
    }
  } catch (e) {
    const err = e as { message?: string }
    const output = `verify 실행 실패: ${err.message ?? String(e)}`
    return {
      command: detected.command,
      projectKind: detected.projectKind,
      exitCode: -1,
      passed: false,
      output,
      durationMs: Date.now() - startedAt,
      timedOut: false,
      failureKind: 'env',
    }
  }
}

/**
 * 동일 검증 실패가 반복되는지 추적하기 위한 시그니처 추출.
 * 출력의 첫 200자 + 마지막 200자를 해시로 변환해 반환.
 */
export function verifySignature(result: VerifyResult): string {
  const head = result.output.slice(0, 200)
  const tail = result.output.slice(-200)
  return `${result.exitCode}::${head}::${tail}`
}
