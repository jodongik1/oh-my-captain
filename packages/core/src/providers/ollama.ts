import { Ollama } from 'ollama'
import { BaseProvider } from './base.js'
import { XmlFilteringStreamProcessor } from './stream_processor.js'
import type { Message, StreamChunk, AssistantMessage, ToolCall, ModelCapability } from './types.js'
import type { ToolDefinition } from '../tools/registry.js'
import { makeLogger } from '../utils/logger.js'

const log = makeLogger('ollama.ts')

const VISION_FAMILY_RE = /^(clip|mllama|siglip|paligemma)$/i

export class OllamaProvider extends BaseProvider {
  readonly name = 'ollama'
  private client: Ollama

  constructor(config: { model: string; baseUrl: string; apiKey?: string; contextWindow: number; requestTimeoutMs: number }) {
    super(config)
    this.client = new Ollama({ host: config.baseUrl })
  }

  async stream(
    messages: Message[],
    tools: ToolDefinition[],
    onChunk: (chunk: StreamChunk) => void,
    signal?: AbortSignal
  ): Promise<AssistantMessage> {
    const { effective, timeout, timeoutMs } = this.makeEffectiveSignal(signal)

    const ollamaMessages = messages.map(m => {
      if (m.role === 'tool') {
        // tool_call_id 를 함께 보내야 모델이 어떤 호출의 결과인지 매칭할 수 있다.
        return { role: 'tool' as const, tool_call_id: m.tool_call_id, content: m.content }
      }
      if (BaseProvider.hasAttachments(m)) {
        return {
          role: 'user' as const,
          content: m.content,
          images: m.attachments.map(a => a.data),
        } as unknown as Message
      }
      return m
    })

    log.debug('=== [Ollama Request] ===')
    log.debug(`Model: ${this.baseConfig.model}`)
    log.debug(`Messages Count: ${ollamaMessages.length}`)
    ollamaMessages.forEach((m, idx) => {
      log.debug(`[${idx}] Role: ${m.role}`)
      if (m.role === 'assistant' && (m as { tool_calls?: unknown }).tool_calls) {
        log.debug(`  Tool Calls: ${JSON.stringify((m as { tool_calls?: unknown }).tool_calls)}`)
      }
      if (m.role === 'tool') {
        log.debug(`  Tool Result: ${m.content.substring(0, 200)}${m.content.length > 200 ? '...' : ''}`)
      } else {
        log.debug(`  Content: ${m.content.substring(0, 200)}${m.content.length > 200 ? '...' : ''}`)
      }
    })
    if (tools.length > 0) {
      log.debug(`Available Tools: ${tools.map(t => t.function.name).join(', ')}`)
    }
    log.debug('========================')

    const response = await this.client.chat({
      model: this.baseConfig.model,
      messages: ollamaMessages as unknown as { role: string; content: string }[],
      tools: tools.length > 0 ? (tools as unknown as object[]) : undefined,
      stream: true,
      options: { num_ctx: this.baseConfig.contextWindow },
    } as never)

    const processor = new XmlFilteringStreamProcessor()
    let fullContent = ''
    let nativeThinking = ''
    let toolCalls: ToolCall[] | undefined

    const detachAbort = this.attachAbort(effective, () => response.abort())

    try {
      for await (const chunk of response) {
        if (effective.aborted) break
        // qwen3 등 native reasoning 모델은 thinking 을 별도 필드로 분리해 보낸다.
        // chunk.message.thinking 을 캡처해 UI thinking 채널로 forward + 본문 빈 폴백 시 사용.
        const thinkingDelta = (chunk.message as unknown as { thinking?: string } | undefined)?.thinking
        if (thinkingDelta) {
          nativeThinking += thinkingDelta
          onChunk({ thinking: thinkingDelta })
        }
        const delta = chunk.message?.content
        if (delta) {
          fullContent += delta
          processor.feedText(delta, onChunk)
        }
        if (chunk.message?.tool_calls) {
          toolCalls = chunk.message.tool_calls.map((tc: { id?: string; function: { name: string; arguments: string | Record<string, unknown> } }) => ({
            id: tc.id ?? `call_${Date.now()}`,
            function: {
              name: tc.function.name,
              arguments: typeof tc.function.arguments === 'string'
                ? JSON.parse(tc.function.arguments)
                : tc.function.arguments,
            },
          }))
        }
        const finishedChunk = chunk as unknown as { done?: boolean; done_reason?: string; eval_count?: number; prompt_eval_count?: number }
        if (finishedChunk.done && !effective.aborted) {
          if (finishedChunk.done_reason === 'length') {
            log.warn(`⚠ context window 초과로 응답이 잘림 (done_reason=length) model=${this.baseConfig.model} ctx=${this.baseConfig.contextWindow} eval=${finishedChunk.eval_count} prompt_eval=${finishedChunk.prompt_eval_count}`)
          } else {
            log.info(`스트림 정상 종료 (done_reason=${finishedChunk.done_reason}) model=${this.baseConfig.model} eval=${finishedChunk.eval_count} prompt_eval=${finishedChunk.prompt_eval_count}`)
          }
        }
      }
    } catch (e) {
      if (effective.aborted) {
        if (timeout.aborted) {
          log.warn(`⏱ 타임아웃으로 스트림 중단 (timeout=${timeoutMs}ms, contentLength=${fullContent.length})`)
          throw this.makeTimeoutError(timeoutMs)
        }
        log.warn(`사용자 중단 (contentLength=${fullContent.length})`)
        return { role: 'assistant', content: fullContent, tool_calls: undefined }
      }
      throw e
    } finally {
      detachAbort()
      processor.flush(onChunk)
    }

    // Native tool_calls가 없을 때만 XML 폴백 결과 사용 (중복 방지)
    const textToolCalls = processor.extractedToolCalls
    if (textToolCalls.length > 0 && (!toolCalls || toolCalls.length === 0)) {
      log.info(`[Ollama] Native tool_calls가 없어 TextToolCallFilter 결과(${textToolCalls.length}개)를 폴백으로 사용합니다.`)
      toolCalls = textToolCalls
    }
    let safeContent = processor.sanitizeContent(fullContent)

    // 본문이 사실상 비어있고 도구 호출도 없는데 native thinking 이 있으면 thinking 을 답변으로 승격.
    // qwen3 같은 모델이 native reasoning 안에 답변 본체까지 작성한 경우에 해당.
    if (safeContent.trim().length <= 4 && (!toolCalls || toolCalls.length === 0) && nativeThinking.trim().length > 0) {
      log.warn(
        `⚠ Ollama 본문이 비고 도구 호출도 없음 — native thinking(${nativeThinking.length}자)을 답변으로 승격. ` +
        `모델이 reasoning 모드 안에 답변 본체를 작성한 것으로 보임.`
      )
      safeContent = nativeThinking.trim()
    }

    log.debug('=== [Ollama Response] ===')
    log.debug(`Content: ${safeContent.substring(0, 200)}${safeContent.length > 200 ? '...' : ''}`)
    if (nativeThinking) {
      log.debug(`Native Thinking: ${nativeThinking.substring(0, 200)}${nativeThinking.length > 200 ? '...' : ''}`)
    }
    if (toolCalls && toolCalls.length > 0) {
      log.debug(`Tool Calls Requested:`)
      toolCalls.forEach((tc, idx) => {
        log.debug(`  [${idx}] ${tc.function.name} (${JSON.stringify(tc.function.arguments)})`)
      })
    }
    log.debug('=========================')

    return { role: 'assistant', content: safeContent, tool_calls: toolCalls }
  }

  async complete(prompt: string): Promise<string> {
    const response = await this.client.chat({
      model: this.baseConfig.model,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      options: { num_ctx: this.baseConfig.contextWindow },
    })
    return response.message.content
  }

  /**
   * Ollama 의 /api/show 응답에서 capabilities 를 동적으로 추출.
   * 신버전: 명시적 capabilities 배열 / 구버전: families('clip' 등) + projector_info fallback.
   * 호출 실패 시 빈 배열 반환 (호출자가 패턴 fallback 가능).
   */
  async getCapabilities(modelId: string): Promise<ModelCapability[]> {
    try {
      const showResp = await this.client.show({ model: modelId } as { model: string })
      const caps = new Set<ModelCapability>()

      const explicit = (showResp as unknown as { capabilities?: string[] }).capabilities
      if (Array.isArray(explicit)) for (const c of explicit) caps.add(c)

      const details = (showResp as { details?: { families?: string[] } }).details
      const families = details?.families
      if (Array.isArray(families) && families.some(f => VISION_FAMILY_RE.test(f))) {
        caps.add('vision')
      }
      if ((showResp as unknown as { projector_info?: unknown }).projector_info) {
        caps.add('vision')
      }
      if (!caps.has('completion')) caps.add('completion')

      log.debug(`Ollama capabilities for ${modelId}: ${Array.from(caps).join(', ')}`)
      return Array.from(caps)
    } catch (e) {
      log.warn(`/api/show 실패 for ${modelId} — capability 추론 fallback (${(e as Error).message})`)
      return []
    }
  }
}

export async function fetchOllamaModels(baseUrl: string, apiKey?: string): Promise<string[]> {
  const res = await fetch(`${baseUrl}/api/tags`, {
    headers: apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {},
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`Ollama 연결 실패: ${res.status}`)
  const data = await res.json() as { models: Array<{ name: string }> }
  return data.models.map(m => m.name).sort()
}

export async function fetchOllamaModelInfo(
  baseUrl: string,
  modelName: string,
  apiKey?: string
): Promise<{ contextWindow: number; capabilities: string[] }> {
  const res = await fetch(`${baseUrl}/api/show`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify({ name: modelName }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`모델 정보 조회 실패: ${res.status}`)
  const data = await res.json() as {
    model_info?: Record<string, unknown>
    capabilities?: string[]
    details?: { families?: string[] }
    projector_info?: unknown
  }

  const arch = data.model_info?.['general.architecture'] as string | undefined
  const contextKey = arch ? `${arch}.context_length` : undefined
  const contextWindow = contextKey
    ? (data.model_info?.[contextKey] as number | undefined) ?? 32768
    : 32768

  const caps = new Set<string>()
  if (Array.isArray(data.capabilities)) for (const c of data.capabilities) caps.add(c)
  if (Array.isArray(data.details?.families) && data.details!.families!.some(f => VISION_FAMILY_RE.test(f))) {
    caps.add('vision')
  }
  if (data.projector_info) caps.add('vision')
  if (!caps.has('completion')) caps.add('completion')

  return { contextWindow, capabilities: Array.from(caps) }
}

export async function testOllamaConnection(baseUrl: string, apiKey?: string): Promise<boolean> {
  try {
    await fetchOllamaModels(baseUrl, apiKey)
    return true
  } catch {
    return false
  }
}
