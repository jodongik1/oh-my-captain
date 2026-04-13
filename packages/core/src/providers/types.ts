import type { ToolDefinition } from '../tools/registry.js'

export interface StreamChunk {
  token?: string
  toolCalls?: OllamaToolCall[]
}

export interface OllamaToolCall {
  id: string
  function: { name: string; arguments: Record<string, unknown> }
}

export interface AssistantMessage {
  role: 'assistant'
  content: string
  tool_calls?: OllamaToolCall[]
}

export interface LLMProvider {
  readonly name: string
  stream(
    messages: Message[],
    tools: ToolDefinition[],
    onChunk: (chunk: StreamChunk) => void,
    signal?: AbortSignal
  ): Promise<AssistantMessage>
  /** 비스트리밍 단일 응답. Context Compactor의 구조화 요약에 사용 */
  complete(prompt: string): Promise<string>
}

export type Message =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; tool_calls?: OllamaToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }
