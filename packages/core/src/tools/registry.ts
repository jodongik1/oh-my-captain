import type { HostAdapter } from '../host/interface.js'
import type { OllamaToolCall } from '../providers/types.js'

export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>  // JSON Schema
  }
}

type ToolImpl = (args: Record<string, unknown>, host: HostAdapter) => Promise<unknown>

const tools = new Map<string, { definition: ToolDefinition; impl: ToolImpl }>()

export function registerTool(definition: ToolDefinition, impl: ToolImpl) {
  tools.set(definition.function.name, { definition, impl })
}

export function getToolDefinitions(): ToolDefinition[] {
  return Array.from(tools.values()).map(t => t.definition)
}

export async function dispatch(call: OllamaToolCall, host: HostAdapter): Promise<unknown> {
  const tool = tools.get(call.function.name)
  if (!tool) return { error: `정의되지 않은 도구: ${call.function.name}` }
  try {
    return await tool.impl(call.function.arguments, host)
  } catch (e: any) {
    return { error: e.message }
  }
}
