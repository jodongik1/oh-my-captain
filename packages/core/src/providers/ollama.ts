import { Ollama } from 'ollama'
import type { LLMProvider, Message, StreamChunk, AssistantMessage, OllamaToolCall } from './types.js'
import type { ToolDefinition } from '../tools/registry.js'
import { TextToolCallFilter } from './text_tool_call_filter.js'
import { logger } from '../utils/logger.js'

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

  // [흐름 6-a] loop.ts의 provider.stream() 호출 → Ollama HTTP 스트리밍 실제 실행
  // 토큰 수신마다 onChunk 콜백 호출 → host.emit('stream_chunk') → IPC stdout → UI
  async stream(
    messages: Message[],
    tools: ToolDefinition[],
    onChunk: (chunk: StreamChunk) => void,
    signal?: AbortSignal
  ): Promise<AssistantMessage> {
    // 사용자 abort 신호와 타임아웃 신호를 병합 (먼저 발생하는 쪽으로 중단)
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

    // Ollama HTTP API에 스트리밍 요청 (num_ctx로 컨텍스트 윈도우 크기 지정)
    const response = await this.client.chat({
      model: this.config.model,
      messages: ollamaMessages as any,
      tools: tools.length > 0 ? tools as any : undefined,
      stream: true,
      options: { num_ctx: this.config.contextWindow },
    } as any)

    let fullContent = ''
    let toolCalls: OllamaToolCall[] | undefined
    // 일부 모델은 도구 호출을 JSON이 아닌 XML 텍스트로 반환하는데,
    // TextToolCallFilter가 이를 감지/억제하고 구조화된 tool_calls로 변환
    const filter = new TextToolCallFilter()

    const abortHandler = () => response.abort()
    effectiveSignal.addEventListener('abort', abortHandler)

    try {
      // 청크 단위 스트리밍 수신 루프
      for await (const chunk of response) {
        if (effectiveSignal.aborted) break
        const delta = chunk.message?.content
        if (delta) {
          fullContent += delta
          // 도구 호출 XML 패턴 감지 시 억제하고 안전한 텍스트만 UI로 전달
          const safe = filter.feed(delta)
          if (safe) onChunk({ token: safe })
        }
        if (chunk.message?.tool_calls) {
          // 구조화된 tool_calls 수신 (Ollama가 JSON 형태로 반환한 경우)
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
        // 마지막 청크: 컨텍스트 초과 여부 로깅
        if ((chunk as any).done && !effectiveSignal.aborted) {
          const doneReason = (chunk as any).done_reason
          const evalCount = (chunk as any).eval_count
          const promptEvalCount = (chunk as any).prompt_eval_count
          if (doneReason === 'length') {
            logger.warn({ doneReason, evalCount, promptEvalCount, model: this.config.model, contextWindow: this.config.contextWindow }, '[Ollama] ⚠ context window 초과로 응답이 잘림 (done_reason=length)')
          } else {
            logger.info({ doneReason, evalCount, promptEvalCount, model: this.config.model }, '[Ollama] 스트림 정상 종료')
          }
        }
      }
    } catch (e: any) {
      // abort에 의한 중단 처리
      if (effectiveSignal.aborted) {
        if (timeoutSignal.aborted) {
          logger.warn({ timeoutMs, contentLength: fullContent.length }, '[Ollama] ⏱ 타임아웃으로 스트림 중단')
          throw Object.assign(new Error(`응답 시간이 초과되었습니다 (${timeoutMs / 1000}초). 설정에서 요청 타임아웃을 늘려주세요.`), { code: 'TIMEOUT' })
        }
        logger.warn({ contentLength: fullContent.length }, '[Ollama] 사용자 중단')
        return { role: 'assistant', content: fullContent, tool_calls: undefined }
      }
      throw e
    } finally {
      effectiveSignal.removeEventListener('abort', abortHandler)
      // 필터 내부에 버퍼링된 잔여 텍스트 방출
      const remaining = filter.flush()
      if (remaining) onChunk({ token: remaining })
    }

    // 텍스트에서 파싱된 도구 호출(XML 방식)이 있으면 structured tool_calls에 병합
    const textToolCalls = filter.parsedToolCalls
    if (textToolCalls.length > 0) {
      toolCalls = [...(toolCalls ?? []), ...textToolCalls]
    }

    // loop.ts로 반환 → tool_calls 여부에 따라 도구 실행 또는 루프 종료 분기
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
