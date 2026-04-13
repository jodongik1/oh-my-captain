import { Ollama } from 'ollama'
import type { LLMProvider, Message, StreamChunk, AssistantMessage, OllamaToolCall } from './types.js'
import type { ToolDefinition } from '../tools/registry.js'

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
    // 외부 signal과 타임아웃을 결합
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
    let toolCalls: OllamaToolCall[] | undefined

    const abortHandler = () => response.abort()
    effectiveSignal.addEventListener('abort', abortHandler)

    try {
      for await (const chunk of response) {
        if (effectiveSignal.aborted) break
        const delta = chunk.message?.content
        if (delta) {
          fullContent += delta
          onChunk({ token: delta })
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
      }
    } catch (e: any) {
      // abort에 의한 중단은 정상
      if (effectiveSignal.aborted) {
        return { role: 'assistant', content: fullContent, tool_calls: undefined }
      }
      throw e
    } finally {
      effectiveSignal.removeEventListener('abort', abortHandler)
    }

    return {
      role: 'assistant',
      content: fullContent,
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

// 설정 화면의 Model 드롭다운에 채울 모델 목록 조회
export async function fetchOllamaModels(baseUrl: string, apiKey?: string): Promise<string[]> {
  const res = await fetch(`${baseUrl}/api/tags`, {
    headers: apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {},
    signal: AbortSignal.timeout(10_000)  // 10초 타임아웃
  })
  if (!res.ok) throw new Error(`Ollama 연결 실패: ${res.status}`)
  const data = await res.json() as { models: Array<{ name: string }> }
  return data.models.map(m => m.name).sort()
}

// 모델 선택 시 Context Window 자동 감지
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

// 연결 테스트
export async function testOllamaConnection(baseUrl: string, apiKey?: string): Promise<boolean> {
  try {
    await fetchOllamaModels(baseUrl, apiKey)
    return true
  } catch {
    return false
  }
}
