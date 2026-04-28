import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { detectProjectStack } from '../project_stack.js'

function makeTempProject(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'omc-stack-'))
  for (const [name, content] of Object.entries(files)) {
    const full = join(root, name)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, content, 'utf-8')
  }
  return root
}

describe('detectProjectStack', () => {
  it('빈 디렉토리에는 빈 문자열 반환', async () => {
    const root = mkdtempSync(join(tmpdir(), 'omc-stack-empty-'))
    try {
      const out = await detectProjectStack(root)
      expect(out).toBe('')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  describe('Node 프로젝트', () => {
    let root: string
    beforeAll(() => {
      root = makeTempProject({
        'package.json': JSON.stringify({
          name: 'sample',
          packageManager: 'pnpm@10.0.0',
          workspaces: ['packages/*'],
          devDependencies: { typescript: '^5', vitest: '^1' },
          scripts: { build: 'tsc', test: 'vitest', 'test:run': 'vitest run', lint: 'eslint .' },
        }),
      })
    })
    afterAll(() => rmSync(root, { recursive: true, force: true }))

    it('pnpm + workspace + TypeScript + vitest 를 감지', async () => {
      const out = await detectProjectStack(root)
      expect(out).toContain('pnpm')
      expect(out).toContain('workspace')
      expect(out).toContain('TypeScript')
      expect(out).toContain('vitest')
      expect(out).toContain('pnpm test')
    })
  })

  describe('Maven 프로젝트', () => {
    let root: string
    beforeAll(() => {
      root = makeTempProject({
        'pom.xml': `<?xml version="1.0"?>
<project>
  <properties>
    <maven.compiler.source>17</maven.compiler.source>
  </properties>
  <dependencies>
    <dependency>
      <groupId>org.junit.jupiter</groupId>
      <artifactId>junit-jupiter</artifactId>
      <version>5.10.1</version>
    </dependency>
    <dependency>
      <groupId>org.assertj</groupId>
      <artifactId>assertj-core</artifactId>
      <version>3.24.2</version>
    </dependency>
    <dependency>
      <groupId>org.mockito</groupId>
      <artifactId>mockito-core</artifactId>
      <version>5.0</version>
    </dependency>
  </dependencies>
</project>`,
      })
    })
    afterAll(() => rmSync(root, { recursive: true, force: true }))

    it('Maven · Java 17 · JUnit 5 · AssertJ · Mockito 모두 감지', async () => {
      const out = await detectProjectStack(root)
      expect(out).toContain('Maven')
      expect(out).toContain('Java 17')
      expect(out).toContain('JUnit 5')
      expect(out).toContain('5.10.1')
      expect(out).toContain('AssertJ')
      expect(out).toContain('Mockito')
      expect(out).toContain('mvn -q test')
    })
  })

  describe('Gradle (Kotlin DSL) 프로젝트', () => {
    let root: string
    beforeAll(() => {
      root = makeTempProject({
        'build.gradle.kts': `
plugins { id("org.jetbrains.kotlin.jvm") version "1.9.0" }
dependencies {
  testImplementation("org.junit.jupiter:junit-jupiter:5.10.0")
  testImplementation("io.mockk:mockk:1.13.0")
}
tasks.test { useJUnitPlatform() }
`,
      })
    })
    afterAll(() => rmSync(root, { recursive: true, force: true }))

    it('Gradle Kotlin DSL · Kotlin · JUnit 5 · MockK 감지', async () => {
      const out = await detectProjectStack(root)
      expect(out).toContain('Gradle (Kotlin DSL)')
      expect(out).toContain('Kotlin')
      expect(out).toContain('JUnit 5')
      expect(out).toContain('MockK')
      expect(out).toContain('./gradlew test')
    })
  })

  describe('Cargo / Go / Python', () => {
    it('Cargo edition 감지', async () => {
      const root = makeTempProject({
        'Cargo.toml': `[package]\nname = "sample"\nedition = "2021"\n`,
      })
      try {
        const out = await detectProjectStack(root)
        expect(out).toContain('Rust (edition 2021)')
        expect(out).toContain('cargo test')
      } finally { rmSync(root, { recursive: true, force: true }) }
    })

    it('Go module / version 감지', async () => {
      const root = makeTempProject({
        'go.mod': `module example.com/foo\n\ngo 1.21\n`,
      })
      try {
        const out = await detectProjectStack(root)
        expect(out).toContain('Go 1.21')
        expect(out).toContain('module example.com/foo')
        expect(out).toContain('go test ./...')
      } finally { rmSync(root, { recursive: true, force: true }) }
    })

    it('Poetry + pytest 감지', async () => {
      const root = makeTempProject({
        'pyproject.toml': `[tool.poetry]\nname = "x"\n[tool.poetry.dev-dependencies]\npytest = "^7"\n`,
      })
      try {
        const out = await detectProjectStack(root)
        expect(out).toContain('Poetry')
        expect(out).toContain('Python')
        expect(out).toContain('pytest')
      } finally { rmSync(root, { recursive: true, force: true }) }
    })
  })

  describe('손상된 manifest', () => {
    it('package.json 파싱 실패 시 조용히 스킵하고 다른 매니페스트는 정상 처리', async () => {
      const root = makeTempProject({
        'package.json': '{ broken json',
        'go.mod': 'module foo\n\ngo 1.20\n',
      })
      try {
        const out = await detectProjectStack(root)
        expect(out).not.toContain('TypeScript')
        expect(out).toContain('Go 1.20')
      } finally { rmSync(root, { recursive: true, force: true }) }
    })
  })
})
