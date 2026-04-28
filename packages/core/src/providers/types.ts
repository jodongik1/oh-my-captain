import type { ToolDefinition } from '../tools/registry.js'

export interface StreamChunk {
  /** 사용자에게 노출되는 응답 토큰 */
  token?: string
  /** 추론 모델이 노출하는 사고(thinking) 토큰. extended thinking 활성화 시에만 채워짐 */
  thinking?: string
  toolCalls?: ToolCall[]
}

/** LLM이 반환하는 도구 호출 정보 (모든 프로바이더 공통) */
export interface ToolCall {
  id: string
  function: { name: string; arguments: Record<string, unknown> }
}

export interface AssistantMessage {
  role: 'assistant'
  content: string
  tool_calls?: ToolCall[]
}

/**
 * 모델 capability 식별자 — LSP-style 의 자유 문자열로 두어 향후 확장 용이.
 * 현재 정의: 'completion', 'vision', 'tools', 'thinking'
 */
export type ModelCapability = 'completion' | 'vision' | 'tools' | 'thinking' | string

export interface LLMProvider {
  readonly name: string
  stream(
    messages: Message[],
    tools: ToolDefinition[],
    onChunk: (chunk: StreamChunk) => void,
    signal?: AbortSignal
  ): Promise<AssistantMessage>
  /** 비스트리밍 단일 응답. Context Compactor의 구조화 요약에 사용 */
  complete(prompt: string): Promise<string>
  /**
   * 주어진 모델 ID 의 capabilities 를 조회한다.
   * - Ollama: /api/show 의 capabilities + families 를 동적으로 검사
   * - Anthropic/OpenAI: 모델 이름 패턴 기반 (cloud provider 는 capability API 부재)
   * 실패 시 빈 배열 반환 (호출자가 fallback 가능).
   */
  getCapabilities?(modelId: string): Promise<ModelCapability[]>
}

/**
 * LLM SDK 호출에 직접 전달되는 이미지 입력 형식.
 * IPC/UI 형식(@omc/protocol 의 ImageAttachment) 에서 kind/filename 같은 메타를 떨군 축소형.
 * - protocol.ImageAttachment: 와이어 형식 (UI ↔ host ↔ core)
 * - ProviderImageInput: provider stream 호출 직전 LLM SDK 가 받는 형식
 */
export interface ProviderImageInput {
  mediaType: string  // 'image/png' 등
  data: string       // base64 (no data: prefix)
}

export type Message =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string; attachments?: ProviderImageInput[] }
  | { role: 'assistant'; content: string; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }
