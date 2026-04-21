import { Ollama } from 'ollama'
import type { LLMProvider, Message, StreamChunk, AssistantMessage, ToolCall } from './types.js'
import type { ToolDefinition } from '../tools/registry.js'
import { TextToolCallFilter } from './text_tool_call_filter.js'
import { makeLogger } from '../utils/logger.js'

const log = makeLogger('ollama.ts')

export class OllamaProvider implements LLMProvider {
  private client: Ollama

  constructor(private config: {
    model: string
    baseUrl: string
    apiKey?: string
    contextWindow: number
    requestTimeoutMs: number
  }) {
    this.client = new Ollama({ host: this.config.baseUrl })
  }

  readonly name = 'ollama'

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

    const ollamaMessages = messages.map(m => {
      if (m.role === 'tool') {
        return { role: 'tool' as const, content: m.content }
      }
      return m
    })

    const response = await this.client.chat({
      model: this.config.model,
      messages: ollamaMessages as any,
      tools: tools.length > 0 ? tools as any : undefined,
      stream: true,
      options: { num_ctx: this.config.contextWindow },
    } as any)

    let fullContent = ''
    let toolCalls: ToolCall[] | undefined
    const filter = new TextToolCallFilter()

    const abortHandler = () => response.abort()
    effectiveSignal.addEventListener('abort', abortHandler)

    try {
      for await (const chunk of response) {
        if (effectiveSignal.aborted) break
        const delta = chunk.message?.content
        if (delta) {
          fullContent += delta
          const safe = filter.feed(delta)
          if (safe) onChunk({ token: safe })
        }
        if (chunk.message?.tool_calls) {
          toolCalls = chunk.message.tool_calls.map((tc: any) => ({
            id: tc.id ?? `call_${Date.now()}`,
            function: {
              name: tc.function.name,
              arguments: typeof tc.function.arguments === 'string'
                ? JSON.parse(tc.function.arguments)
                : tc.function.arguments
            }
          }))
        }
        if ((chunk as any).done && !effectiveSignal.aborted) {
          const doneReason = (chunk as any).done_reason
          const evalCount = (chunk as any).eval_count
          const promptEvalCount = (chunk as any).prompt_eval_count
          if (doneReason === 'length') {
            log.warn(`⚠ context window 초과로 응답이 잘림 (done_reason=length) model=${this.config.model} ctx=${this.config.contextWindow} eval=${evalCount} prompt_eval=${promptEvalCount}`)
          } else {
            log.info(`스트림 정상 종료 (done_reason=${doneReason}) model=${this.config.model} eval=${evalCount} prompt_eval=${promptEvalCount}`)
          }
        }
      }
    } catch (e: any) {
      if (effectiveSignal.aborted) {
        if (timeoutSignal.aborted) {
          log.warn(`⏱ 타임아웃으로 스트림 중단 (timeout=${timeoutMs}ms, contentLength=${fullContent.length})`)
          throw Object.assign(new Error(`응답 시간이 초과되었습니다 (${timeoutMs / 1000}초). 설정에서 요청 타임아웃을 늘려주세요.`), { code: 'TIMEOUT' })
        }
        log.warn(`사용자 중단 (contentLength=${fullContent.length})`)
        return { role: 'assistant', content: fullContent, tool_calls: undefined }
      }
      throw e
    } finally {
      effectiveSignal.removeEventListener('abort', abortHandler)
      const remaining = filter.flush()
      if (remaining) onChunk({ token: remaining })
    }

    const textToolCalls = filter.parsedToolCalls
    if (textToolCalls.length > 0) {
      toolCalls = [...(toolCalls ?? []), ...textToolCalls]
    }
    const safeContent = stripToolCallXml(fullContent)
    return {
      role: 'assistant',
      content: safeContent,
      tool_calls: toolCalls
    }
  }

  async complete(prompt: string): Promise<string> {
    const response = await this.client.chat({
      model: this.config.model,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      options: { num_ctx: this.config.contextWindow }
    })
    return response.message.content
  }
}

function stripToolCallXml(text: string): string {
  return text
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
    .replace(/<\s*function\s*=\s*\w+[\s\S]*?<\/function>/g, '')
    .replace(/<\/tool_call>/g, '')
    .replace(/<\/function>/g, '')
    .trimEnd()
}

export async function fetchOllamaModels(baseUrl: string, apiKey?: string): Promise<string[]> {
  const res = await fetch(`${baseUrl}/api/tags`, {
    headers: apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {},
    signal: AbortSignal.timeout(10_000)
  })
  if (!res.ok) throw new Error(`Ollama 연결 실패: ${res.status}`)
  const data = await res.json() as { models: Array<{ name: string }> }
  return data.models.map(m => m.name).sort()
}

export async function fetchOllamaModelInfo(
  baseUrl: string,
  modelName: string,
  apiKey?: string
): Promise<{ contextWindow: number }> {
  const res = await fetch(`${baseUrl}/api/show`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {})
    },
    body: JSON.stringify({ name: modelName }),
    signal: AbortSignal.timeout(10_000)
  })
  if (!res.ok) throw new Error(`모델 정보 조회 실패: ${res.status}`)
  const data = await res.json() as { model_info?: Record<string, unknown> }

  const arch = data.model_info?.['general.architecture'] as string | undefined
  const contextKey = arch ? `${arch}.context_length` : undefined
  const contextWindow = contextKey
    ? (data.model_info?.[contextKey] as number | undefined) ?? 32768
    : 32768

  return { contextWindow }
}

export async function testOllamaConnection(baseUrl: string, apiKey?: string): Promise<boolean> {
  try {
    await fetchOllamaModels(baseUrl, apiKey)
    return true
  } catch {
    return false
  }
}
