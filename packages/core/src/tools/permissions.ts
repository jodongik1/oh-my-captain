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

export type ToolCategory = 'readonly' | 'write' | 'destructive'
export type PermissionDecision = 'allow' | 'deny' | 'prompt'

/**
 * 모드별 기본 정책.
 * - plan: 읽기만 허용, 쓰기/파괴적 행위 거부
 * - ask:  읽기 허용, 쓰기/파괴적 행위는 사용자 승인 필요
 * - auto: 모두 허용
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
  // Plan 모드에서 run_terminal의 읽기전용 명령은 허용
  if (mode === 'plan' && toolName === 'run_terminal' && category === 'destructive') {
    const command = (args.command as string) || ''
    if (isReadOnlyCommand(command)) {
      return 'allow'
    }
  }

  // Ask 모드에서 run_terminal의 파괴적 명령(rm 등)만 승인 요청
  if (mode === 'ask' && toolName === 'run_terminal') {
    const command = (args.command as string) || ''
    if (isDestructiveCommand(command)) {
      return 'prompt'
    }
    return 'allow'
  }

  // ── Step 3: 모드별 정책 ──
  const policy = MODE_POLICY[mode]
  if (!policy) return 'prompt'  // 알 수 없는 모드 → 확인 요청

  const decision = policy[category]

  // ── Step 4: Allow rules (future: .captain/allow.json) ──
  // 현재는 skip

  // ── Step 5: 최종 결정 반환 ──
  return decision
}

/**
 * 권한 거부 시 반환할 결과를 생성합니다.
 */
export function buildDeniedResult(toolName: string, mode: string): Record<string, unknown> {
  return {
    denied: true,
    tool: toolName,
    mode,
    reason: `Tool '${toolName}' is not allowed in ${mode} mode.`,
    suggestion: mode === 'plan'
      ? 'Present your plan as a structured proposal. Once approved, the user will switch to Ask or Auto mode for execution.'
      : 'This action requires explicit permission from the user.',
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
