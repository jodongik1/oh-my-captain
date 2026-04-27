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
}

interface VerifyCommand {
  projectKind: string
  command: string
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

/** 프로젝트 루트의 파일들을 보고 적절한 검증 명령을 결정 */
async function detectVerifyCommand(projectRoot: string): Promise<VerifyCommand | null> {
  // ── Node / TypeScript ──
  if (await exists(join(projectRoot, 'package.json'))) {
    const script = await findNpmVerifyScript(projectRoot)
    if (script) {
      // pnpm 우선, 없으면 npm
      const useP = await exists(join(projectRoot, 'pnpm-lock.yaml'))
      const cmd = useP ? `pnpm run ${script}` : `npm run ${script}`
      return { projectKind: 'node', command: cmd }
    }
    // scripts 에 검증용이 없지만 tsconfig 가 있으면 tsc --noEmit
    if (await exists(join(projectRoot, 'tsconfig.json'))) {
      return { projectKind: 'typescript', command: 'npx --no-install tsc --noEmit' }
    }
  } else if (await exists(join(projectRoot, 'tsconfig.json'))) {
    return { projectKind: 'typescript', command: 'npx --no-install tsc --noEmit' }
  }

  // ── Python ──
  if (await exists(join(projectRoot, 'pyproject.toml')) || await exists(join(projectRoot, 'requirements.txt'))) {
    // 우선 ruff (빠름), 없으면 mypy 시도
    return { projectKind: 'python', command: 'ruff check . || python -m mypy .' }
  }

  // ── Kotlin / Java (Gradle) ──
  if (await exists(join(projectRoot, 'build.gradle.kts')) || await exists(join(projectRoot, 'build.gradle'))) {
    return { projectKind: 'gradle', command: './gradlew --quiet compileKotlin compileJava 2>/dev/null || ./gradlew --quiet build -x test' }
  }

  // ── Java (Maven) ──
  if (await exists(join(projectRoot, 'pom.xml'))) {
    return { projectKind: 'maven', command: 'mvn -q compile' }
  }

  // ── Go ──
  if (await exists(join(projectRoot, 'go.mod'))) {
    return { projectKind: 'go', command: 'go build ./...' }
  }

  // ── Rust ──
  if (await exists(join(projectRoot, 'Cargo.toml'))) {
    return { projectKind: 'rust', command: 'cargo check --quiet' }
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

    return {
      command: detected.command,
      projectKind: detected.projectKind,
      exitCode: result.exitCode ?? -1,
      passed: result.exitCode === 0 && !result.timedOut,
      output,
      durationMs: Date.now() - startedAt,
      timedOut: result.timedOut ?? false,
    }
  } catch (e) {
    const err = e as { message?: string }
    return {
      command: detected.command,
      projectKind: detected.projectKind,
      exitCode: -1,
      passed: false,
      output: `verify 실행 실패: ${err.message ?? String(e)}`,
      durationMs: Date.now() - startedAt,
      timedOut: false,
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
