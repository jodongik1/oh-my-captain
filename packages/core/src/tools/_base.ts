// 도구 등록/실행 공통 헬퍼.
// 기존 registerTool 은 그대로 유지되며, 신규 도구는 defineTool 로 zod 검증 + 자동 추론을 받을 수 있다.
import { z } from 'zod'
import { registerTool, type ToolDefinition } from './registry.js'
import { resolveSecurePath } from '../utils/path.js'
import type { HostAdapter } from '../host/interface.js'

export interface DefineToolSpec<I, O> {
  name: string
  description: string
  /** LLM 에 노출되는 JSON Schema (zod schema 와 별개) */
  parameters: Record<string, unknown>
  /** 입력 검증용 zod 스키마 */
  schema: z.ZodSchema<I>
  category: ToolDefinition['category']
  concurrencySafe: boolean
  preview?: ToolDefinition['preview']
  run: (input: I, host: HostAdapter) => Promise<O>
}

/**
 * registerTool 의 zod 자동 검증 래퍼. 신규 도구는 이 함수를 사용한다.
 * - 입력은 schema.parse() 로 자동 검증되어 run() 에 전달
 * - 에러는 registry.dispatch 의 catch 가 일관 처리
 */
export function defineTool<I, O>(spec: DefineToolSpec<I, O>): void {
  registerTool(
    {
      type: 'function',
      function: { name: spec.name, description: spec.description, parameters: spec.parameters },
      category: spec.category,
      concurrencySafe: spec.concurrencySafe,
      preview: spec.preview,
    },
    async (rawArgs, host) => {
      const input = spec.schema.parse(rawArgs)
      return spec.run(input, host)
    }
  )
}

/**
 * 도구 인자의 path/cwd 를 안전하게 해석한다.
 * - 미지정이면 프로젝트 루트
 * - 지정되면 resolveSecurePath 로 traversal 차단 + 정규화
 */
export function resolvePathOrRoot(maybe: string | undefined, host: HostAdapter): string {
  if (!maybe) return host.getProjectRoot()
  return resolveSecurePath(maybe, host.getProjectRoot())
}
