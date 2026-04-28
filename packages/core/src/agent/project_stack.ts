/**
 * 프로젝트 스택 자동 감지 — 매 세션 시작 시 빌드 manifest 를 한 번 스캔해
 * 시스템 프롬프트에 짧은 요약을 주입한다.
 *
 * 목적: LLM 이 "이 프로젝트는 Maven + JUnit 5" 같은 결정적 정보를 도구 호출 없이
 * 즉시 알 수 있도록 함. 토큰 비용 0, 탐색 turn 1개 절약.
 *
 * 의미적 정보(README 요약, 컨벤션 등)는 /init 슬래시 커맨드 + .captain/MEMORY.md 에서 담당.
 */

import { readFile } from 'fs/promises'
import { join } from 'path'

async function readMaybe(path: string): Promise<string | null> {
  try { return await readFile(path, 'utf-8') } catch { return null }
}

/**
 * 빌드 manifest 들을 병렬로 읽고 발견한 스택을 markdown bullet 리스트로 반환.
 * 발견된 게 없으면 빈 문자열을 반환 (호출자가 섹션 자체를 생략).
 */
export async function detectProjectStack(projectRoot: string): Promise<string> {
  const [pkg, pom, gradleKts, gradle, cargo, gomod, pyproject, requirements] = await Promise.all([
    readMaybe(join(projectRoot, 'package.json')),
    readMaybe(join(projectRoot, 'pom.xml')),
    readMaybe(join(projectRoot, 'build.gradle.kts')),
    readMaybe(join(projectRoot, 'build.gradle')),
    readMaybe(join(projectRoot, 'Cargo.toml')),
    readMaybe(join(projectRoot, 'go.mod')),
    readMaybe(join(projectRoot, 'pyproject.toml')),
    readMaybe(join(projectRoot, 'requirements.txt')),
  ])

  const lines: string[] = []

  if (pkg) lines.push(...analyzeNode(pkg))
  if (pom) lines.push(...analyzeMaven(pom))
  if (gradleKts || gradle) lines.push(...analyzeGradle(gradleKts ?? gradle ?? '', !!gradleKts))
  if (cargo) lines.push(...analyzeCargo(cargo))
  if (gomod) lines.push(...analyzeGo(gomod))
  if (pyproject || requirements) lines.push(...analyzePython(pyproject ?? '', requirements ?? ''))

  return lines.join('\n')
}

function analyzeNode(pkgRaw: string): string[] {
  const lines: string[] = []
  try {
    const json = JSON.parse(pkgRaw) as {
      name?: string
      packageManager?: string
      workspaces?: unknown
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
      scripts?: Record<string, string>
      pnpm?: { workspaces?: unknown }
    }
    const isWorkspace = !!json.workspaces || !!json.pnpm?.workspaces
    let pm = 'npm'
    if (json.packageManager?.startsWith('pnpm')) pm = 'pnpm'
    else if (json.packageManager?.startsWith('yarn')) pm = 'yarn'

    const deps = { ...(json.dependencies ?? {}), ...(json.devDependencies ?? {}) }
    const testFw = ['vitest', 'jest', 'mocha', 'jasmine', 'ava', 'tap'].find(t => t in deps)
    const isTs = 'typescript' in deps
    const interestingScripts = Object.keys(json.scripts ?? {}).filter(s =>
      ['build', 'test', 'test:run', 'lint', 'typecheck', 'check', 'dev'].includes(s)
    )

    lines.push(`- **빌드/언어**: ${pm}${isWorkspace ? ' workspace' : ''} · ${isTs ? 'TypeScript' : 'JavaScript'}`)
    if (testFw) lines.push(`- **테스트 프레임워크**: ${testFw}`)
    if (interestingScripts.length > 0) {
      const cmds = interestingScripts.slice(0, 6).map(s => `\`${pm} ${s}\``).join(', ')
      lines.push(`- **주요 스크립트**: ${cmds}`)
    }
  } catch {
    // package.json 파싱 실패는 조용히 스킵
  }
  return lines
}

function analyzeMaven(pom: string): string[] {
  const lines: string[] = []
  const junitMatch = pom.match(/<artifactId>(junit-jupiter|junit-jupiter-api|junit)<\/artifactId>[\s\S]{0,200}?<version>([\d.]+)/)
  const javaMatch = pom.match(/<(?:maven\.compiler\.(?:source|target)|java\.version)>(\d+)</)
  const javaVersion = javaMatch ? javaMatch[1] : undefined
  lines.push(`- **빌드/언어**: Maven · Java${javaVersion ? ` ${javaVersion}` : ''}`)
  if (junitMatch) {
    const fw = junitMatch[1].includes('jupiter') ? 'JUnit 5' : 'JUnit'
    lines.push(`- **테스트 프레임워크**: ${fw} ${junitMatch[2]}`)
  }
  if (/assertj/i.test(pom)) lines.push(`- **단언 라이브러리**: AssertJ`)
  if (/mockito/i.test(pom)) lines.push(`- **모킹**: Mockito`)
  lines.push(`- **테스트 명령**: \`mvn -q test\``)
  return lines
}

function analyzeGradle(content: string, isKotlinDsl: boolean): string[] {
  const lines: string[] = []
  const useJunit5 = /junit-jupiter|useJUnitPlatform/.test(content)
  const useKotlin = /kotlin\(/i.test(content) || /apply\s+plugin:\s*['"]kotlin/i.test(content) || /id\s*\(\s*"org\.jetbrains\.kotlin/i.test(content)
  lines.push(`- **빌드/언어**: Gradle${isKotlinDsl ? ' (Kotlin DSL)' : ''} · ${useKotlin ? 'Kotlin' : 'Java'}`)
  if (useJunit5) lines.push(`- **테스트 프레임워크**: JUnit 5`)
  if (/mockk/i.test(content)) lines.push(`- **모킹**: MockK`)
  else if (/mockito/i.test(content)) lines.push(`- **모킹**: Mockito`)
  lines.push(`- **테스트 명령**: \`./gradlew test\``)
  return lines
}

function analyzeCargo(cargo: string): string[] {
  const editionMatch = cargo.match(/edition\s*=\s*"(\d+)"/)
  return [
    `- **빌드/언어**: Cargo · Rust${editionMatch ? ` (edition ${editionMatch[1]})` : ''}`,
    `- **테스트 명령**: \`cargo test\``,
  ]
}

function analyzeGo(gomod: string): string[] {
  const moduleMatch = gomod.match(/^module\s+(\S+)/m)
  const goVersionMatch = gomod.match(/^go\s+([\d.]+)/m)
  return [
    `- **빌드/언어**: Go${goVersionMatch ? ` ${goVersionMatch[1]}` : ''}${moduleMatch ? ` (module ${moduleMatch[1]})` : ''}`,
    `- **테스트 명령**: \`go test ./...\``,
  ]
}

function analyzePython(pyproject: string, requirements: string): string[] {
  const usesPoetry = pyproject.includes('[tool.poetry]')
  const usesUv = pyproject.includes('[tool.uv]')
  const usesPip = !!requirements
  const pkgMgr = usesPoetry ? 'Poetry' : usesUv ? 'uv' : usesPip ? 'pip' : 'pip'
  const lines: string[] = [`- **빌드/언어**: ${pkgMgr} · Python`]
  if (/pytest/.test(pyproject) || /pytest/.test(requirements)) {
    lines.push(`- **테스트 프레임워크**: pytest`)
    lines.push(`- **테스트 명령**: \`pytest\``)
  }
  return lines
}
