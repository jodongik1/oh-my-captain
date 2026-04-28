// 모든 LLM provider 가 공통으로 갖는 동작을 모아 둔 추상 클래스.
// 각 provider 의 SDK 호출 방식이 너무 달라 stream/complete 본체는 서브클래스에 맡기고,
// 여기서는 다음을 공유한다:
//  - 요청 timeout + 사용자 abort 의 신호 합성 (makeEffectiveSignal)
//  - abort listener 의 add/remove 라이프사이클 (attachAbort)
//  - 표준 TIMEOUT 에러 생성 (makeTimeoutError)
//  - 이미지 첨부 안전 추출 (타입 가드)
//  - cloud provider 의 capability 추론 fallback (모델 이름 정규식 → capability)
import type { LLMProvider, Message, ProviderImageInput, ModelCapability } from './types.js'

export interface BaseProviderConfig {
  model: string
  contextWindow: number
  /** 0 또는 미지정이면 120 초 fallback */
  requestTimeoutMs: number
}

/**
 * 모델 이름 패턴 → 추가 capability 매핑.
 * 예: { vision: /gpt-4o|claude-(3|opus-4)/i, thinking: /o1|o3|claude-3-7/i }
 */
export type CapabilityPatterns = Partial<Record<Exclude<ModelCapability, 'completion' | 'tools'>, RegExp>>

export abstract class BaseProvider implements LLMProvider {
  abstract readonly name: string

  constructor(protected readonly baseConfig: BaseProviderConfig) {}

  abstract stream(...args: Parameters<LLMProvider['stream']>): ReturnType<LLMProvider['stream']>
  abstract complete(prompt: string): Promise<string>

  /**
   * 사용자 abort + 요청 timeout 두 신호를 하나로 합쳐 SDK 에 전달할 수 있게 한다.
   * SDK 가 자체 timeout 옵션을 갖는 경우(Anthropic) 도 user abort 를 stream 에 wiring 하기 위해 사용.
   */
  protected makeEffectiveSignal(signal?: AbortSignal): {
    effective: AbortSignal
    timeout: AbortSignal
    timeoutMs: number
  } {
    const timeoutMs = this.baseConfig.requestTimeoutMs || 120_000
    const timeout = AbortSignal.timeout(timeoutMs)
    const effective = signal ? AbortSignal.any([signal, timeout]) : timeout
    return { effective, timeout, timeoutMs }
  }

  /**
   * abort signal 에 listener 를 한 번 등록하고 detach 함수를 반환.
   * SDK 가 자체 signal 옵션을 받지 않는 경우(Anthropic stream, Ollama response) 에 사용.
   * 이미 abort 된 signal 은 즉시 onAbort 호출.
   */
  protected attachAbort(signal: AbortSignal, onAbort: () => void): () => void {
    if (signal.aborted) {
      onAbort()
      return () => {}
    }
    signal.addEventListener('abort', onAbort, { once: true })
    return () => signal.removeEventListener('abort', onAbort)
  }

  /** 표준 TIMEOUT 에러 — 호출자(loop/UI) 가 code === 'TIMEOUT' 으로 분류 */
  protected makeTimeoutError(timeoutMs: number): Error & { code: 'TIMEOUT' } {
    return Object.assign(
      new Error(`응답 시간이 초과되었습니다 (${timeoutMs / 1000}초). 설정에서 요청 타임아웃을 늘려주세요.`),
      { code: 'TIMEOUT' as const },
    )
  }

  /**
   * cloud provider 가 capability 정보를 노출하지 않을 때 사용하는 정규식 fallback.
   * 'completion' / 'tools' 는 기본 포함. patterns 에 매칭되는 capability 를 추가한다.
   */
  protected fallbackCapabilities(modelId: string, patterns: CapabilityPatterns): ModelCapability[] {
    const m = modelId.toLowerCase()
    const caps: ModelCapability[] = ['completion', 'tools']
    for (const [cap, regex] of Object.entries(patterns) as Array<[ModelCapability, RegExp]>) {
      if (regex.test(m)) caps.push(cap)
    }
    return caps
  }

  /** Message 가 이미지 첨부를 가진 user 메시지인지 좁힌다. */
  static hasAttachments(m: Message): m is Message & { role: 'user'; content: string; attachments: ProviderImageInput[] } {
    return m.role === 'user' && Array.isArray((m as { attachments?: unknown[] }).attachments)
      && ((m as { attachments: unknown[] }).attachments.length > 0)
  }
}
