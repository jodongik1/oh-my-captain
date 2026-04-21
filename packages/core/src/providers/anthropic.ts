import Anthropic from '@anthropic-ai/sdk'
import type { LLMProvider, Message, StreamChunk, AssistantMessage, ToolCall } from './types.js'
import type { ToolDefinition } from '../tools/registry.js'

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic

  constructor(private config: {
    model: string
    apiKey: string
    contextWindow: number
    requestTimeoutMs: number
  }) {
    this.client = new Anthropic({
      apiKey: this.config.apiKey,
      timeout: this.config.requestTimeoutMs,
    })
  }

  readonly name = 'anthropic'

  async stream(
    messages: Message[],
    tools: ToolDefinition[],
    onChunk: (chunk: StreamChunk) => void,
    signal?: AbortSignal
  ): Promise<AssistantMessage> {
    // Anthropic은 system 메시지를 별도 파라미터로 분리
    const systemMsg = messages.find(m => m.role === 'system')?.content ?? ''
    const chatMessages = messages.filter(m => m.role !== 'system')

    const anthropicMessages: Anthropic.MessageParam[] = chatMessages.map(m => {
      if (m.role === 'tool') {
        return {
          role: 'user' as const,
          content: [{
            type: 'tool_result' as const,
            tool_use_id: m.tool_call_id,
            content: m.content
          }]
        }
      }
      if (m.role === 'assistant' && m.tool_calls?.length) {
        const content: Anthropic.ContentBlockParam[] = []
        if (m.content) content.push({ type: 'text', text: m.content })
        for (const tc of m.tool_calls) {
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input: tc.function.arguments
          })
        }
        return { role: 'assistant' as const, content }
      }
      return { role: m.role as 'user' | 'assistant', content: m.content }
    })

    const anthropicTools: Anthropic.Tool[] | undefined =
      tools.length > 0
        ? tools.map(t => ({
            name: t.function.name,
            description: t.function.description,
            input_schema: t.function.parameters as Anthropic.Tool.InputSchema
          }))
        : undefined

    const stream = this.client.messages.stream({
      model: this.config.model,
      max_tokens: 8192,
      system: systemMsg,
      messages: anthropicMessages,
      tools: anthropicTools,
    })

    // AbortSignal 연동
    if (signal) {
      const onAbort = () => stream.abort()
      signal.addEventListener('abort', onAbort, { once: true })
    }

    let fullContent = ''
    const toolCalls: ToolCall[] = []

    stream.on('text', (text) => {
      fullContent += text
      onChunk({ token: text })
    })

    try {
      const finalMessage = await stream.finalMessage()

      for (const block of finalMessage.content) {
        if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            function: {
              name: block.name,
              arguments: block.input as Record<string, unknown>
            }
          })
        }
        if (block.type === 'text') {
          fullContent = block.text
        }
      }
    } catch (e: any) {
      if (signal?.aborted) {
        return { role: 'assistant', content: fullContent, tool_calls: undefined }
      }
      throw e
    }

    return {
      role: 'assistant',
      content: fullContent,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined
    }
  }

  async complete(prompt: string): Promise<string> {
    const response = await this.client.messages.create({
      model: this.config.model,
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    })
    const textBlock = response.content.find(b => b.type === 'text')
    return textBlock?.text ?? ''
  }
}
