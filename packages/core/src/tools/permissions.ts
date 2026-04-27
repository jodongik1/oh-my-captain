/**
 * 5단계 권한 시스템 — Claude Code Permission Resolution 패턴.
 *
 * 해결 순서:
 *   1. Pre-hook  (future, 현재 skip)
 *   2. Deny rules (plan 모드 쓰기 거부 등)
 *   3. Mode policy (plan / ask / auto)
 *   4. Allow rules (.captain/allow.json, future)
 *   5. Runtime prompt (host.requestApproval)
 */

import { makeLogger } from '../utils/logger.js'

const log = makeLogger('permissions.ts')

export type ToolCategory = 'readonly' | 'write' | 'destructive'
export type PermissionDecision = 'allow' | 'deny' | 'prompt'

/**
 * 모드별 기본 정책.
 * - plan: 읽기만 허용, 쓰기/파괴적 행위 거부
 * - ask:  읽기 허용, 쓰기/파괴적 행위는 사용자 승인 필요
 * - auto: 무조건 모두 허용 (사용자 승인 절대 없음 — 파괴적 명령 포함)
 */
const MODE_POLICY: Record<string, Record<ToolCategory, PermissionDecision>> = {
  plan:  { readonly: 'allow', write: 'deny',   destructive: 'deny' },
  ask:   { readonly: 'allow', write: 'prompt', destructive: 'prompt' },
  auto:  { readonly: 'allow', write: 'allow',  destructive: 'allow' },
}

/**
 * Plan 모드에서도 실행 허용되는 읽기전용 셸 명령 패턴.
 * grep, ls, cat 등 파일 시스템을 변경하지 않는 명령.
 */
const READ_ONLY_COMMAND_PATTERN = /^\s*(ls|cat|head|tail|grep|rg|find|git\s+(status|log|diff|show|branch|remote|blame)|wc|file|stat|echo|pwd|which|type|man|tree|du|df|env|printenv|hostname|uname|date|whoami|id|groups)\b/

export function isReadOnlyCommand(command: string): boolean {
  return READ_ONLY_COMMAND_PATTERN.test(command)
}

/**
 * 파괴적(destructive) 셸 명령 패턴.
 * rm, rmdir, git push --force, git reset --hard 등 되돌리기 어려운 명령.
 */
const DESTRUCTIVE_COMMAND_PATTERN = /^\s*(rm\b|rmdir\b|git\s+push\s+.*--force|git\s+push\s+-f\b|git\s+reset\s+--hard|git\s+clean\s+-f|git\s+checkout\s+--\s|git\s+branch\s+-D\b)/

export function isDestructiveCommand(command: string): boolean {
  return DESTRUCTIVE_COMMAND_PATTERN.test(command)
}

/**
 * 셸 명령어 체이닝 및 명령어 치환을 감지합니다.
 * ';', '&&', '||', '|', '$(...)', '`...`' 등이 포함된 경우 true.
 * 이런 패턴이 있으면 단순 읽기 전용 판별을 신뢰할 수 없습니다.
 */
const SHELL_CHAINING_PATTERN = /[;|&]|`[^`]*`|\$\(/
export function hasShellChaining(command: string): boolean {
  return SHELL_CHAINING_PATTERN.test(command)
}

/**
 * 단순 파이프 (`|`) 만 사용하고 양쪽 segment 가 모두 readonly 명령인 경우를 감지합니다.
 * 예: `find . -name "*.ts" | head -50` → true
 *     `find ...; rm -rf ...` → false (`;` 포함)
 *     `find ... && cat foo` → false (`&&` 포함)
 *     `find ... | xargs rm` → false (xargs 가 readonly 아님)
 */
const FORBIDDEN_NON_PIPE = /[;&]|`[^`]*`|\$\(/
export function isReadOnlyPipeline(command: string): boolean {
  if (FORBIDDEN_NON_PIPE.test(command)) return false
  if (!command.includes('|')) return false
  const segments = command.split('|').map(s => s.trim()).filter(Boolean)
  if (segments.length < 2) return false
  return segments.every(s => isReadOnlyCommand(s))
}

/**
 * 도구 실행 권한을 해결합니다.
 *
 * @param toolName 도구 이름
 * @param category 도구 카테고리
 * @param args 도구 인수 (run_terminal의 command 검사 등에 사용)
 * @param mode 현재 동작 모드
 * @returns 'allow', 'deny', 또는 'prompt'
 */
export function resolvePermission(
  toolName: string,
  category: ToolCategory,
  args: Record<string, unknown>,
  mode: string
): PermissionDecision {
  // ── Step 1: Pre-hooks (future) ──
  // 현재는 skip

  // ── Step 2: 특수 규칙 ──
  // auto 모드는 무조건 모든 도구 즉시 실행 (사용자 승인 없음).
  // 셸 체이닝/파괴적 명령도 LLM 판단에 위임. 사용자가 의도적으로 선택한 책임 부담 모드.
  if (mode === 'auto') {
    return 'allow'
  }

  if (toolName === 'run_terminal') {
    const command = (args.command as string) || ''

    // 단순 파이프 `find ... | head` 같이 양쪽 모두 readonly 인 경우는 어느 모드에서나 허용
    if (isReadOnlyPipeline(command)) {
      return 'allow'
    }

    // 셸 체이닝/치환이 감지되면 무조건 사용자 승인 요청 (plan/ask 모드)
    if (hasShellChaining(command)) {
      log.debug(`셸 체이닝 감지: tool=${toolName} command="${command}" → prompt`)
      return 'prompt'
    }

    // 파괴적 명령은 무조건 승인 요청 (plan/ask 모드)
    if (isDestructiveCommand(command)) {
      return 'prompt'
    }

    // Plan 모드에서 readonly 명령은 허용
    if (mode === 'plan' && isReadOnlyCommand(command)) {
      return 'allow'
    }

    // Plan 모드에서 readonly 가 아닌 명령은 거부
    if (mode === 'plan') {
      return 'deny'
    }

    // Ask 모드에서 readonly 명령은 허용
    if (isReadOnlyCommand(command)) {
      return 'allow'
    }

    // 그 외 명령은 모드 정책 따름 (ask → prompt)
  }

  // ── Step 3: 모드별 정책 ──
  const policy = MODE_POLICY[mode]
  if (!policy) return 'prompt'  // 알 수 없는 모드 → 확인 요청

  const decision = policy[category]

  // ── Step 4: Allow rules (future: .captain/allow.json) ──
  // 현재는 skip

  // ── Step 5: 최종 결정 반환 ──
  if (decision !== 'allow') {
    log.debug(`권한 결정: tool=${toolName} category=${category} mode=${mode} → ${decision}`)
  }
  return decision
}

/**
 * 권한 거부 시 반환할 결과를 생성합니다.
 */
export function buildDeniedResult(toolName: string, mode: string): { denied: boolean; tool: string; mode: string; reason: string; suggestion: string } {
  const modeLabel = mode === 'plan' ? '플랜' : mode === 'ask' ? '편집 전 확인' : mode === 'auto' ? '자동 편집' : mode
  return {
    denied: true,
    tool: toolName,
    mode,
    reason: `'${toolName}' 도구는 ${modeLabel} 모드에서 허용되지 않습니다.`,
    suggestion: mode === 'plan'
      ? '계획을 구조화된 형태(수정 파일·라인·내용)로 제시하세요. 사용자가 계획을 승인하면 편집 전 확인 또는 자동 편집 모드로 전환하여 실행합니다.'
      : '이 동작에는 사용자의 명시적 승인이 필요합니다.',
  }
}

/**
 * 승인 요청을 위한 설명을 생성합니다.
 */
export function formatApprovalDescription(
  toolName: string,
  args: Record<string, unknown>
): string {
  switch (toolName) {
    case 'write_file':
      return `파일 쓰기: ${args.path} (${String(args.content || '').split('\n').length}줄)`
    case 'edit_file':
      return `파일 편집: ${args.path}`
    case 'run_terminal':
      return `명령어 실행: ${args.command}`
    case 'save_memory':
      return `메모리 저장: ${String(args.content || '').slice(0, 80)}...`
    default:
      return `${toolName} 실행`
  }
}
