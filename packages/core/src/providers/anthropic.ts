import Anthropic from '@anthropic-ai/sdk'
import type { LLMProvider, Message, StreamChunk, AssistantMessage, ToolCall } from './types.js'
import type { ToolDefinition } from '../tools/registry.js'

/** extended thinking(추론 모델) 지원 여부 — 모델 이름으로 자동 감지 */
function supportsExtendedThinking(model: string): boolean {
  return /claude-(3-7|opus-4|sonnet-4|haiku-4)/i.test(model)
}

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
      // user 메시지에 이미지 첨부가 있으면 multipart 로 전환 (Anthropic 형식)
      if (m.role === 'user' && (m as { attachments?: { mediaType: string; data: string }[] }).attachments?.length) {
        const atts = (m as { attachments: { mediaType: string; data: string }[] }).attachments
        const parts: Anthropic.ContentBlockParam[] = []
        for (const a of atts) {
          parts.push({
            type: 'image',
            source: {
              type: 'base64',
              // SDK 0.37 의 Base64ImageSource 타입 미공개 — runtime 에는 OK
              media_type: a.mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
              data: a.data,
            },
          })
        }
        if (m.content) parts.push({ type: 'text', text: m.content })
        return { role: 'user' as const, content: parts }
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

    const useThinking = supportsExtendedThinking(this.config.model)
    const requestParams: Anthropic.MessageStreamParams = {
      model: this.config.model,
      max_tokens: useThinking ? 16384 : 8192,
      system: systemMsg,
      messages: anthropicMessages,
      tools: anthropicTools,
    }
    if (useThinking) {
      // 추론 모델 전용 옵션. 사용자에게 사고 시간/내용을 노출 가능.
      ;(requestParams as unknown as Record<string, unknown>).thinking = {
        type: 'enabled',
        budget_tokens: 4000,
      }
    }

    const stream = this.client.messages.stream(requestParams)

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

    // extended thinking 이 활성화된 경우 thinking_delta 를 별도 채널로 전달
    if (useThinking) {
      // SDK 의 streamEvent 이벤트는 정식 타입에 노출되지 않을 수 있어 우회 캐스트로 구독
      const streamAny = stream as unknown as {
        on: (event: string, listener: (e: unknown) => void) => void
      }
      streamAny.on('streamEvent', (event: unknown) => {
        const e = event as { type?: string; delta?: { type?: string; thinking?: string } }
        if (
          e?.type === 'content_block_delta' &&
          e.delta?.type === 'thinking_delta' &&
          typeof e.delta.thinking === 'string'
        ) {
          onChunk({ thinking: e.delta.thinking })
        }
      })
    }

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

  async getCapabilities(modelId: string): Promise<string[]> {
    // Anthropic /v1/models 는 capability 정보를 노출하지 않음.
    // Claude 3 이상 + Opus/Sonnet/Haiku 4 는 모두 vision + tools + thinking 지원.
    const m = modelId.toLowerCase()
    const caps: string[] = ['completion', 'tools']
    if (/claude-(3|opus-4|sonnet-4|haiku-4)/.test(m)) caps.push('vision')
    if (/claude-(3-7|opus-4|sonnet-4|haiku-4)/.test(m)) caps.push('thinking')
    return caps
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
