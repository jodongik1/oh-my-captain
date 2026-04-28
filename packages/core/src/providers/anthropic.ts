import Anthropic from '@anthropic-ai/sdk'
import { BaseProvider } from './base.js'
import { BasicStreamProcessor } from './stream_processor.js'
import type { Message, StreamChunk, AssistantMessage, ToolCall, ModelCapability } from './types.js'
import type { ToolDefinition } from '../tools/registry.js'

/** extended thinking(추론 모델) 지원 여부 — 모델 이름으로 자동 감지 */
function supportsExtendedThinking(model: string): boolean {
  return /claude-(3-7|opus-4|sonnet-4|haiku-4)/i.test(model)
}

export class AnthropicProvider extends BaseProvider {
  readonly name = 'anthropic'
  private client: Anthropic

  constructor(config: { model: string; apiKey: string; contextWindow: number; requestTimeoutMs: number }) {
    super(config)
    this.client = new Anthropic({ apiKey: config.apiKey, timeout: config.requestTimeoutMs })
  }

  async stream(
    messages: Message[],
    tools: ToolDefinition[],
    onChunk: (chunk: StreamChunk) => void,
    signal?: AbortSignal
  ): Promise<AssistantMessage> {
    // user abort + 요청 timeout 합성. timeout 발사 시에도 stream 을 abort 시켜야
    // finalMessage() 가 영구 블록되지 않는다.
    const { effective, timeout, timeoutMs } = this.makeEffectiveSignal(signal)

    // Anthropic은 system 메시지를 별도 파라미터로 분리
    const systemMsg = messages.find(m => m.role === 'system')?.content ?? ''
    const chatMessages = messages.filter(m => m.role !== 'system')

    const anthropicMessages: Anthropic.MessageParam[] = chatMessages.map(m => {
      if (m.role === 'tool') {
        return {
          role: 'user' as const,
          content: [{ type: 'tool_result' as const, tool_use_id: m.tool_call_id, content: m.content }],
        }
      }
      if (m.role === 'assistant' && m.tool_calls?.length) {
        const content: Anthropic.ContentBlockParam[] = []
        if (m.content) content.push({ type: 'text', text: m.content })
        for (const tc of m.tool_calls) {
          content.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input: tc.function.arguments })
        }
        return { role: 'assistant' as const, content }
      }
      if (BaseProvider.hasAttachments(m)) {
        const parts: Anthropic.ContentBlockParam[] = []
        for (const a of m.attachments) {
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

    const anthropicTools: Anthropic.Tool[] | undefined = tools.length > 0
      ? tools.map(t => ({
          name: t.function.name,
          description: t.function.description,
          input_schema: t.function.parameters as Anthropic.Tool.InputSchema,
        }))
      : undefined

    const useThinking = supportsExtendedThinking(this.baseConfig.model)
    const requestParams: Anthropic.MessageStreamParams = {
      model: this.baseConfig.model,
      max_tokens: useThinking ? 16384 : 8192,
      system: systemMsg,
      messages: anthropicMessages,
      tools: anthropicTools,
    }
    if (useThinking) {
      ;(requestParams as unknown as Record<string, unknown>).thinking = { type: 'enabled', budget_tokens: 4000 }
    }

    const stream = this.client.messages.stream(requestParams)

    // user abort + timeout 양쪽 모두 stream 을 즉시 abort 시킨다.
    const detachAbort = this.attachAbort(effective, () => stream.abort())

    const processor = new BasicStreamProcessor()
    let fullContent = ''
    const toolCalls: ToolCall[] = []

    stream.on('text', (text) => {
      fullContent += text
      processor.feedText(text, onChunk)
    })

    if (useThinking) {
      // SDK 의 streamEvent 이벤트는 정식 타입에 노출되지 않을 수 있어 우회 캐스트로 구독
      const streamAny = stream as unknown as { on: (event: string, listener: (e: unknown) => void) => void }
      streamAny.on('streamEvent', (event: unknown) => {
        const e = event as { type?: string; delta?: { type?: string; thinking?: string } }
        if (e?.type === 'content_block_delta' && e.delta?.type === 'thinking_delta' && typeof e.delta.thinking === 'string') {
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
            function: { name: block.name, arguments: block.input as Record<string, unknown> },
          })
        }
        if (block.type === 'text') {
          fullContent = block.text
        }
      }
    } catch (e) {
      if (effective.aborted) {
        // timeout 으로 인한 abort 는 명시적 에러로 변환 (UI 가 재시도 안내 가능)
        if (timeout.aborted) throw this.makeTimeoutError(timeoutMs)
        // 사용자 abort 는 누적된 콘텐츠를 그대로 반환
        return { role: 'assistant', content: fullContent, tool_calls: undefined }
      }
      throw e
    } finally {
      detachAbort()
      processor.flush(onChunk)
    }

    return {
      role: 'assistant',
      content: processor.sanitizeContent(fullContent),
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    }
  }

  async getCapabilities(modelId: string): Promise<ModelCapability[]> {
    return this.fallbackCapabilities(modelId, {
      vision: /claude-(3|opus-4|sonnet-4|haiku-4)/,
      thinking: /claude-(3-7|opus-4|sonnet-4|haiku-4)/,
    })
  }

  async complete(prompt: string): Promise<string> {
    const response = await this.client.messages.create({
      model: this.baseConfig.model,
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    })
    const textBlock = response.content.find(b => b.type === 'text')
    return textBlock?.text ?? ''
  }
}
