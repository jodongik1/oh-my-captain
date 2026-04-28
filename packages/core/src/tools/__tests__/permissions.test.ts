import { describe, it, expect } from 'vitest'
import {
  isReadOnlyCommand,
  isDestructiveCommand,
  isReadOnlyPipeline,
  hasShellChaining,
  resolvePermission,
} from '../permissions.js'

describe('isReadOnlyCommand', () => {
  it.each([
    ['ls -la', true],
    ['cat /etc/hosts', true],
    ['grep foo bar.txt', true],
    ['rg pattern', true],
    ['git status', true],
    ['git log --oneline', true],
    ['git push origin main', false],
    ['rm -rf node_modules', false],
    ['npm install', false],
    ['echo hi', true],
  ])('%s -> %s', (cmd, expected) => {
    expect(isReadOnlyCommand(cmd)).toBe(expected)
  })
})

describe('isDestructiveCommand', () => {
  it.each([
    ['rm file.txt', true],
    ['rmdir dir', true],
    ['git push --force origin', true],
    ['git push -f origin', true],
    ['git reset --hard HEAD~1', true],
    ['git status', false],
    ['ls', false],
  ])('%s -> %s', (cmd, expected) => {
    expect(isDestructiveCommand(cmd)).toBe(expected)
  })
})

describe('hasShellChaining', () => {
  it.each([
    ['ls && cat foo', true],
    ['echo a; echo b', true],
    ['$(rm -rf /)', true],
    ['`whoami`', true],
    ['echo a | head', true],
    ['ls -la', false],
  ])('%s -> %s', (cmd, expected) => {
    expect(hasShellChaining(cmd)).toBe(expected)
  })
})

describe('isReadOnlyPipeline', () => {
  it('readonly | readonly 는 true', () => {
    expect(isReadOnlyPipeline('find . -name "*.ts" | head -50')).toBe(true)
    expect(isReadOnlyPipeline('grep foo file | wc -l')).toBe(true)
  })

  it('파이프 없으면 false', () => {
    expect(isReadOnlyPipeline('ls -la')).toBe(false)
  })

  it('한쪽이 readonly 가 아니면 false', () => {
    expect(isReadOnlyPipeline('find . | xargs rm')).toBe(false)
  })

  it(';/&&/$()/`` 가 섞이면 false', () => {
    expect(isReadOnlyPipeline('find . | head; rm foo')).toBe(false)
    expect(isReadOnlyPipeline('find . && echo done')).toBe(false)
  })
})

describe('resolvePermission', () => {
  it('auto 모드는 무조건 allow', () => {
    expect(resolvePermission('write_file', 'write', { path: 'x' }, 'auto')).toBe('allow')
    expect(resolvePermission('run_terminal', 'destructive', { command: 'rm -rf /' }, 'auto')).toBe('allow')
  })

  it('plan 모드: readonly 도구는 allow, write 는 deny', () => {
    expect(resolvePermission('read_file', 'readonly', {}, 'plan')).toBe('allow')
    expect(resolvePermission('write_file', 'write', {}, 'plan')).toBe('deny')
    expect(resolvePermission('edit_file', 'write', {}, 'plan')).toBe('deny')
  })

  it('plan 모드: run_terminal 의 readonly 명령은 allow, 그 외는 deny', () => {
    expect(resolvePermission('run_terminal', 'destructive', { command: 'ls -la' }, 'plan')).toBe('allow')
    expect(resolvePermission('run_terminal', 'destructive', { command: 'npm install' }, 'plan')).toBe('deny')
  })

  it('plan/ask 모드: 파괴적 명령은 prompt', () => {
    expect(resolvePermission('run_terminal', 'destructive', { command: 'rm -rf foo' }, 'plan')).toBe('prompt')
    expect(resolvePermission('run_terminal', 'destructive', { command: 'rm -rf foo' }, 'ask')).toBe('prompt')
  })

  it('ask 모드: write 도구는 prompt', () => {
    expect(resolvePermission('write_file', 'write', {}, 'ask')).toBe('prompt')
  })

  it('알 수 없는 모드는 안전쪽으로 prompt', () => {
    expect(resolvePermission('write_file', 'write', {}, 'mystery')).toBe('prompt')
  })

  it('readonly 파이프라인은 plan 모드에서도 allow', () => {
    expect(resolvePermission('run_terminal', 'destructive', { command: 'find . | head' }, 'plan')).toBe('allow')
  })

  it('셸 체이닝이 감지되면 plan/ask 에서 prompt', () => {
    expect(resolvePermission('run_terminal', 'destructive', { command: 'ls && rm foo' }, 'ask')).toBe('prompt')
  })
})
