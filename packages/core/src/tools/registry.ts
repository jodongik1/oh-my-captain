import type { HostAdapter } from '../host/interface.js'
import type { OllamaToolCall } from '../providers/types.js'
import { resolvePermission, buildDeniedResult, formatApprovalDescription } from './permissions.js'
import type { ToolCategory } from './permissions.js'

export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>  // JSON Schema
  }
  category: ToolCategory          // 권한 분류: readonly | write | destructive
  concurrencySafe: boolean        // 병렬 실행 가능 여부
  preview?: (args: Record<string, unknown>, host: HostAdapter) => Promise<Record<string, unknown>>
}

type ToolImpl = (args: Record<string, unknown>, host: HostAdapter) => Promise<unknown>

const tools = new Map<string, { definition: ToolDefinition; impl: ToolImpl }>()

export function registerTool(definition: ToolDefinition, impl: ToolImpl) {
  tools.set(definition.function.name, { definition, impl })
}

export function getToolDefinitions(): ToolDefinition[] {
  return Array.from(tools.values()).map(t => t.definition)
}

/** 도구 정의 조회 (병렬/직렬 판단에 사용) */
export function getToolDef(name: string): ToolDefinition | undefined {
  return tools.get(name)?.definition
}

/**
 * 도구를 권한 검사 후 실행합니다.
 * - deny → 즉시 거부 결과 반환
 * - prompt → host.requestApproval() 호출, 거부 시 에러 반환
 * - allow → 바로 실행
 */
export async function dispatch(
  call: OllamaToolCall,
  host: HostAdapter,
  _signal?: AbortSignal
): Promise<unknown> {
  const tool = tools.get(call.function.name)
  if (!tool) return { error: `정의되지 않은 도구: ${call.function.name}` }

  // ── 권한 해결 ──
  const decision = resolvePermission(
    call.function.name,
    tool.definition.category,
    call.function.arguments,
    host.getMode()
  )

  switch (decision) {
    case 'deny': {
      const result = buildDeniedResult(call.function.name, host.getMode())
      host.emit('permission_denied', {
        tool: call.function.name,
        reason: result.reason,
        mode: host.getMode(),
      })
      return result
    }
    case 'prompt': {
      let approvalDetails: Record<string, unknown> = call.function.arguments
      if (tool.definition.preview) {
        try {
          const previewResult = await tool.definition.preview(call.function.arguments, host)
          approvalDetails = { ...approvalDetails, ...previewResult }
        } catch {
          // preview 실패 시 기존 방식으로 진행
        }
      }
      const approved = await host.requestApproval({
        action: call.function.name,
        description: formatApprovalDescription(call.function.name, call.function.arguments),
        risk: tool.definition.category === 'destructive' ? 'high' : 'medium',
        details: approvalDetails,
      })
      if (!approved) return { error: '사용자가 거부했습니다.' }
      break
    }
    case 'allow':
      break
  }

  // ── 실행 ──
  try {
    return await tool.impl(call.function.arguments, host)
  } catch (e: any) {
    return { error: e.message }
  }
}
