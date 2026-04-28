import OpenAI from 'openai'
import { BaseProvider } from './base.js'
import { BasicStreamProcessor } from './stream_processor.js'
import type { Message, StreamChunk, AssistantMessage, ToolCall, ModelCapability } from './types.js'
import type { ToolDefinition } from '../tools/registry.js'

export class OpenAIProvider extends BaseProvider {
  readonly name = 'openai'
  private client: OpenAI

  constructor(config: { model: string; apiKey: string; baseUrl: string; contextWindow: number; requestTimeoutMs: number }) {
    super(config)
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      timeout: config.requestTimeoutMs,
    })
  }

  async stream(
    messages: Message[],
    tools: ToolDefinition[],
    onChunk: (chunk: StreamChunk) => void,
    signal?: AbortSignal
  ): Promise<AssistantMessage> {
    const { effective, timeout, timeoutMs } = this.makeEffectiveSignal(signal)

    const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = messages.map(m => {
      if (m.role === 'tool') {
        return { role: 'tool' as const, tool_call_id: m.tool_call_id, content: m.content }
      }
      if (m.role === 'assistant' && m.tool_calls) {
        return {
          role: 'assistant' as const,
          content: m.content,
          tool_calls: m.tool_calls.map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.function.name, arguments: JSON.stringify(tc.function.arguments) },
          })),
        }
      }
      if (BaseProvider.hasAttachments(m)) {
        const parts: OpenAI.Chat.ChatCompletionContentPart[] = []
        for (const a of m.attachments) {
          parts.push({
            type: 'image_url',
            image_url: { url: `data:${a.mediaType};base64,${a.data}` },
          })
        }
        if (m.content) parts.push({ type: 'text', text: m.content })
        return { role: 'user' as const, content: parts }
      }
      return { role: m.role as 'user' | 'assistant' | 'system', content: m.content }
    })

    const openAiTools: OpenAI.Chat.ChatCompletionTool[] | undefined = tools.length > 0
      ? tools.map(t => ({
          type: 'function' as const,
          function: {
            name: t.function.name,
            description: t.function.description,
            parameters: t.function.parameters as Record<string, unknown>,
          },
        }))
      : undefined

    const stream = await this.client.chat.completions.create({
      model: this.baseConfig.model,
      messages: openAiMessages,
      tools: openAiTools,
      stream: true,
    }, { signal: effective })

    const processor = new BasicStreamProcessor()
    let fullContent = ''
    const toolCallsMap = new Map<number, { id: string; name: string; args: string }>()

    try {
      for await (const chunk of stream) {
        if (effective.aborted) break
        const delta = chunk.choices[0]?.delta
        if (!delta) continue

        if (delta.content) {
          fullContent += delta.content
          processor.feedText(delta.content, onChunk)
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const existing = toolCallsMap.get(tc.index) ?? { id: '', name: '', args: '' }
            if (tc.id) existing.id = tc.id
            if (tc.function?.name) existing.name = tc.function.name
            if (tc.function?.arguments) existing.args += tc.function.arguments
            toolCallsMap.set(tc.index, existing)
          }
        }
      }
    } catch (e) {
      if (effective.aborted) {
        if (timeout.aborted) throw this.makeTimeoutError(timeoutMs)
        return { role: 'assistant', content: fullContent, tool_calls: undefined }
      }
      throw e
    } finally {
      processor.flush(onChunk)
    }

    const toolCalls: ToolCall[] | undefined = toolCallsMap.size > 0
      ? Array.from(toolCallsMap.values()).map(tc => ({
          id: tc.id,
          function: {
            name: tc.name,
            arguments: tc.args ? JSON.parse(tc.args) : {},
          },
        }))
      : undefined

    return { role: 'assistant', content: processor.sanitizeContent(fullContent), tool_calls: toolCalls }
  }

  async getCapabilities(modelId: string): Promise<ModelCapability[]> {
    return this.fallbackCapabilities(modelId, {
      vision: /gpt-4o|gpt-4-turbo|gpt-4-vision|gpt-5|o1|o3|o4/,
      thinking: /o1|o3|o4|gpt-5/,
    })
  }

  async complete(prompt: string): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.baseConfig.model,
      messages: [{ role: 'user', content: prompt }],
    })
    return response.choices[0]?.message?.content ?? ''
  }
}
