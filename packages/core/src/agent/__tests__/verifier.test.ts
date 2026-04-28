import { describe, it, expect } from 'vitest'
import { classifyFailure, verifySignature } from '../verifier.js'
import type { VerifyResult } from '../verifier.js'

describe('classifyFailure', () => {
  it.each([
    ['Non-parseable POM /home/user/pom.xml', 'env'],
    ['Could not find build.gradle', 'env'],
    ['command not found: gradle', 'env'],
    ['ENOENT: spawn mvn', 'env'],
    ['JAVA_HOME not set', 'env'],
    ['Could not transfer artifact', 'env'],
    ['Could not resolve dependencies', 'env'],
    ['Connection refused', 'env'],
    ['error TS2304: Cannot find name foo', 'code'],
    ['CompilationError: missing semicolon', 'code'],
    ['', 'code'],
  ])('%s -> %s', (output, expected) => {
    expect(classifyFailure(output)).toBe(expected)
  })
})

describe('verifySignature', () => {
  const base = (overrides: Partial<VerifyResult> = {}): VerifyResult => ({
    command: 'tsc',
    projectKind: 'typescript',
    exitCode: 1,
    passed: false,
    output: 'short error',
    durationMs: 100,
    timedOut: false,
    ...overrides,
  })

  it('동일 결과는 같은 시그니처', () => {
    expect(verifySignature(base())).toBe(verifySignature(base()))
  })

  it('exitCode 가 다르면 시그니처가 다르다', () => {
    expect(verifySignature(base({ exitCode: 1 }))).not.toBe(verifySignature(base({ exitCode: 2 })))
  })

  it('출력이 길어도 시그니처 길이는 제한된다 (앞 200 + 뒤 200)', () => {
    const longOutput = 'a'.repeat(5000)
    const sig = verifySignature(base({ output: longOutput }))
    expect(sig.length).toBeLessThan(500)
  })
})
