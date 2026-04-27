import OpenAI from 'openai'
import type { LLMProvider, Message, StreamChunk, AssistantMessage, ToolCall } from './types.js'
import type { ToolDefinition } from '../tools/registry.js'

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI

  constructor(private config: {
    model: string
    apiKey: string
    baseUrl: string
    contextWindow: number
    requestTimeoutMs: number
  }) {
    this.client = new OpenAI({
      apiKey: this.config.apiKey,
      baseURL: this.config.baseUrl,
      timeout: this.config.requestTimeoutMs,
    })
  }

  readonly name = 'openai'

  async stream(
    messages: Message[],
    tools: ToolDefinition[],
    onChunk: (chunk: StreamChunk) => void,
    signal?: AbortSignal
  ): Promise<AssistantMessage> {
    const timeoutMs = this.config.requestTimeoutMs || 120_000
    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    const effectiveSignal = signal
      ? AbortSignal.any([signal, timeoutSignal])
      : timeoutSignal

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
            function: { name: tc.function.name, arguments: JSON.stringify(tc.function.arguments) }
          }))
        }
      }
      // user 메시지의 이미지 첨부 → OpenAI multipart (image_url + text)
      if (m.role === 'user' && (m as { attachments?: { mediaType: string; data: string }[] }).attachments?.length) {
        const atts = (m as { attachments: { mediaType: string; data: string }[] }).attachments
        const parts: OpenAI.Chat.ChatCompletionContentPart[] = []
        for (const a of atts) {
          parts.push({
            type: 'image_url',
            image_url: { url: `data:${a.mediaType};base64,${a.data}` },
          })
        }
        if (m.content) parts.push({ type: 'text', text: m.content })
        return { role: 'user' as const, content: parts }
      }
      return { role: m.role as any, content: m.content }
    })

    const openAiTools: OpenAI.Chat.ChatCompletionTool[] | undefined =
      tools.length > 0
        ? tools.map(t => ({
            type: 'function' as const,
            function: {
              name: t.function.name,
              description: t.function.description,
              parameters: t.function.parameters as Record<string, unknown>
            }
          }))
        : undefined

    const stream = await this.client.chat.completions.create({
      model: this.config.model,
      messages: openAiMessages,
      tools: openAiTools,
      stream: true,
    }, { signal: effectiveSignal })

    let fullContent = ''
    const toolCallsMap = new Map<number, { id: string; name: string; args: string }>()

    try {
      for await (const chunk of stream) {
        if (effectiveSignal.aborted) break
        const delta = chunk.choices[0]?.delta
        if (!delta) continue

        if (delta.content) {
          fullContent += delta.content
          onChunk({ token: delta.content })
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
    } catch (e: any) {
      if (effectiveSignal.aborted) {
        return { role: 'assistant', content: fullContent, tool_calls: undefined }
      }
      throw e
    }

    const toolCalls: ToolCall[] | undefined = toolCallsMap.size > 0
      ? Array.from(toolCallsMap.values()).map(tc => ({
          id: tc.id,
          function: {
            name: tc.name,
            arguments: tc.args ? JSON.parse(tc.args) : {}
          }
        }))
      : undefined

    return { role: 'assistant', content: fullContent, tool_calls: toolCalls }
  }

  async getCapabilities(modelId: string): Promise<string[]> {
    // OpenAI /v1/models 는 capability 정보 미노출. 모델 이름 패턴으로 추론.
    const m = modelId.toLowerCase()
    const caps: string[] = ['completion', 'tools']
    if (/gpt-4o|gpt-4-turbo|gpt-4-vision|gpt-5|o1|o3|o4/.test(m)) caps.push('vision')
    if (/o1|o3|o4|gpt-5/.test(m)) caps.push('thinking')
    return caps
  }

  async complete(prompt: string): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.config.model,
      messages: [{ role: 'user', content: prompt }],
    })
    return response.choices[0]?.message?.content ?? ''
  }
}
