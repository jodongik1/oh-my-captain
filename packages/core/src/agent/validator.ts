/**
 * Pre-flight Tool Argument Validator (환각 방어 #3).
 *
 * LLM 이 도구를 호출하기 직전에 인자를 검증한다. 환각으로 인해 다음과 같은 실수를 자주 하는데,
 * 이를 도구 실행 전에 잡아내고 명확한 에러 피드백으로 LLM 에게 돌려주면, 다음 턴에서 스스로 수정한다.
 *
 *   1. 정의되지 않은 도구 이름 호출
 *   2. JSON Schema 의 required 속성 누락
 *   3. 타입 불일치 (예: number 자리에 string)
 *   4. 잘못된 enum 값
 *   5. path traversal 시도 (실제 path 검증은 도구 내부에서 다시 함)
 *
 * 핵심 설계 원칙: **검증 실패는 루프를 멈추지 않는다.**
 * 대신 tool_result 로 자세한 에러 메시지를 만들어 LLM 에 피드백 → 다음 턴 자가수정 유도.
 */

import type { ToolCall } from '../providers/types.js'
import type { ToolDefinition } from '../tools/registry.js'
import { getToolDef } from '../tools/registry.js'
import { makeLogger } from '../utils/logger.js'

const log = makeLogger('validator.ts')

export type ValidationOutcome =
  | { ok: true }
  | { ok: false; error: string; suggestion?: string }

export interface ValidatedToolCall {
  call: ToolCall
  outcome: ValidationOutcome
}

/**
 * 한 번에 여러 tool_calls 를 검증한다. 일부만 실패해도 다른 호출은 그대로 진행할 수 있도록
 * outcome 을 호출별로 반환한다.
 */
export function validateToolCalls(calls: ToolCall[]): ValidatedToolCall[] {
  return calls.map(call => ({
    call,
    outcome: validateSingleToolCall(call),
  }))
}

export function validateSingleToolCall(call: ToolCall): ValidationOutcome {
  // 1. 도구 존재 확인
  const def = getToolDef(call.function.name)
  if (!def) {
    return {
      ok: false,
      error: `정의되지 않은 도구: '${call.function.name}'`,
      suggestion: '시스템 프롬프트의 "사용 가능한 도구" 섹션에 나열된 이름만 사용하세요.',
    }
  }

  // 2. arguments 가 객체인지 확인
  if (!call.function.arguments || typeof call.function.arguments !== 'object' || Array.isArray(call.function.arguments)) {
    return {
      ok: false,
      error: `'${call.function.name}' 의 arguments 가 객체가 아닙니다. JSON 객체 형태({ key: value })로 호출하세요.`,
    }
  }

  // 3. JSON Schema 기본 검증 (required / type / enum)
  const schema = def.function.parameters as JsonSchema
  const args = call.function.arguments
  const schemaError = validateAgainstSchema(args, schema, call.function.name)
  if (schemaError) {
    return { ok: false, error: schemaError, suggestion: buildSuggestion(def, args) }
  }

  // 4. path traversal 사전 차단
  const pathArg = (args as Record<string, unknown>).path ?? (args as Record<string, unknown>).file_path
  if (typeof pathArg === 'string') {
    if (pathArg.startsWith('/')) {
      return {
        ok: false,
        error: `path 는 프로젝트 루트 기준 상대 경로여야 합니다. '/' 로 시작하는 절대경로를 사용하지 마세요. (받은 값: '${pathArg}')`,
        suggestion: `'/' 를 떼고 'src/foo/bar.ts' 처럼 호출하세요.`,
      }
    }
    if (pathArg.includes('..')) {
      return {
        ok: false,
        error: `path 에 '..' 가 포함되어 있습니다 — 프로젝트 외부 접근은 차단됩니다. (받은 값: '${pathArg}')`,
      }
    }
    if (pathArg.startsWith('@')) {
      return {
        ok: false,
        error: `path 에 '@' 가 포함되어 있습니다 — '@' 는 사용자 입력의 멘션 기호이지 경로의 일부가 아닙니다. '@' 를 떼고 다시 호출하세요.`,
      }
    }
  }

  return { ok: true }
}

// ── JSON Schema 미니 검증기 ───────────────────────────────────
// 외부 의존성을 추가하지 않기 위해 우리가 사용하는 스키마 패턴(required/type/enum/properties)만 직접 처리한다.

interface JsonSchema {
  type?: string
  required?: string[]
  properties?: Record<string, JsonSchema>
  enum?: unknown[]
  items?: JsonSchema
  // 이 외 키는 무시
  [key: string]: unknown
}

function validateAgainstSchema(
  args: Record<string, unknown>,
  schema: JsonSchema,
  toolName: string
): string | null {
  if (schema?.type && schema.type !== 'object') {
    // 우리는 항상 object schema 를 사용. 다른 타입이면 검증 패스.
    return null
  }

  // required
  if (Array.isArray(schema.required)) {
    for (const key of schema.required) {
      if (!(key in args)) {
        return `'${toolName}': 필수 인자 '${key}' 가 누락되었습니다.`
      }
    }
  }

  // properties
  if (schema.properties) {
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      if (!(key in args)) continue
      const value = args[key]
      const err = validateValue(value, propSchema, `${toolName}.${key}`)
      if (err) return err
    }
  }

  return null
}

function validateValue(value: unknown, schema: JsonSchema, fieldPath: string): string | null {
  // type 체크
  if (schema.type) {
    const expected = schema.type
    const actual = jsonType(value)
    // 'integer' 는 'number' 로 취급
    const expectedNorm = expected === 'integer' ? 'number' : expected
    if (expectedNorm !== actual && !(expectedNorm === 'number' && actual === 'integer')) {
      return `'${fieldPath}' 의 타입이 잘못됨 — 기대: ${expected}, 실제: ${actual} (값: ${truncate(JSON.stringify(value), 80)})`
    }
  }

  // enum
  if (Array.isArray(schema.enum)) {
    if (!schema.enum.includes(value as never)) {
      return `'${fieldPath}' 의 값이 허용되지 않은 enum — 허용: [${schema.enum.map(v => JSON.stringify(v)).join(', ')}], 실제: ${JSON.stringify(value)}`
    }
  }

  // 배열의 items
  if (schema.type === 'array' && schema.items && Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const err = validateValue(value[i], schema.items, `${fieldPath}[${i}]`)
      if (err) return err
    }
  }

  return null
}

function jsonType(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number'
  return typeof v
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 3) + '...' : s
}

function buildSuggestion(def: ToolDefinition, _args: Record<string, unknown>): string {
  const params = def.function.parameters as JsonSchema
  const required = (params.required ?? []).join(', ')
  return required
    ? `'${def.function.name}' 의 필수 인자: ${required}. 시스템 프롬프트의 도구 정의를 다시 확인하세요.`
    : `시스템 프롬프트의 도구 정의를 다시 확인하세요.`
}

/**
 * 검증 실패 결과를 LLM 에 돌려줄 tool_result 본문(JSON 문자열)으로 변환한다.
 */
export function formatValidationFailure(outcome: Extract<ValidationOutcome, { ok: false }>): string {
  return JSON.stringify({
    error: outcome.error,
    suggestion: outcome.suggestion,
    __preflight: true,
    note: '도구가 실제로 실행되지 않았습니다. 위 오류를 분석하고 다음 turn 에서 올바른 인자로 다시 호출하세요.',
  })
}

// 내부 디버깅을 위해
log.debug('validator.ts loaded')
