import type { StreamChunk, ToolCall } from './types.js'
import { TextToolCallFilter } from './text_tool_call_filter.js'
import { ThinkingTagFilter, splitThinkingTags } from './thinking_tag_filter.js'
import { makeLogger } from '../utils/logger.js'

const log = makeLogger('stream_processor.ts')

/**
 * 스트리밍 토큰 처리 추상화. provider 별로 토큰 필터링 정책이 달라
 * (anthropic/openai 는 그대로 forward, ollama 는 XML 도구호출 필터링)
 * 인터페이스로 분리해 stream 본체의 흐름은 통일하고 정책만 교체한다.
 *
 * 모든 processor 는 공통적으로 `<thinking>...</thinking>` 텍스트 블록을 UI 스트림에서 분리한다
 * (시스템 프롬프트가 강제하는 manual CoT 표기가 사용자 화면에 raw 로 노출되는 것을 막기 위함).
 *
 * 또한 `sanitizeContent` 는 본문이 통째로 thinking 안에 들어간 비정상 케이스(qwen 류 모델이
 * 시스템 프롬프트의 thinking 지시를 과적용해 답변 자체를 thinking 안에 작성)를 폴백 처리한다 —
 * 정상 본문이 비어있으면 thinking 내용을 본문으로 승격한다.
 */
export interface StreamProcessor {
  /** 텍스트 토큰 1개를 처리하고 UI 로 forward 할지 결정 */
  feedText(token: string, onChunk: (c: StreamChunk) => void): void

  /** 스트림 종료 후 잔여 버퍼를 onChunk 에 flush */
  flush(onChunk: (c: StreamChunk) => void): void

  /** 텍스트 스트림에서 부수적으로 추출된 도구 호출 (XML 폴백 등) */
  readonly extractedToolCalls: ToolCall[]

  /** 누적된 raw content 에서 noise(XML 태그/thinking 태그 등) 제거. */
  sanitizeContent(raw: string): string
}

/**
 * 본문이 비어있을 때 thinking 폴백을 적용하는 공통 로직.
 *
 * - content 가 충분히 길면 그대로 반환
 * - content 가 비어있고 thinking 이 의미있는 길이면 thinking 을 본문으로 승격하고 경고 로깅
 * - 둘 다 비면 그대로 빈 문자열
 */
function fallbackToThinkingIfEmpty(content: string, thinking: string): string {
  // 본문이 의미있는 길이면 그대로 반환 (단순 공백/짧은 잔여물 제외)
  if (content.trim().length > 4) return content

  if (thinking.trim().length > 0) {
    log.warn(
      `⚠ 본문이 비어있어 thinking 내용을 답변으로 승격 (content.len=${content.length}, thinking.len=${thinking.length}). ` +
      `모델이 시스템 프롬프트의 thinking 지시를 과적용해 답변 본문을 thinking 안에 작성한 것으로 보임.`
    )
    return thinking
  }
  return content
}

/**
 * anthropic / openai 용 처리기. 평소엔 native tool_use API 가 도구 호출을 담당하지만,
 * 일부 모델이 텍스트로 `<function=...>` XML 을 흘리는 사고를 대비해 동일한 XML 필터를 통과시킨다.
 * 단 extractedToolCalls 는 노출하지 않는다 — provider 가 native 결과를 dispatch 하므로
 * XML 폴백까지 dispatch 하면 같은 도구가 두 번 실행될 수 있다 (UI 누출 방지 역할만 수행).
 */
export class BasicStreamProcessor implements StreamProcessor {
  readonly extractedToolCalls: ToolCall[] = []
  private readonly toolFilter = new TextToolCallFilter()
  private readonly thinking = new ThinkingTagFilter()

  feedText(token: string, onChunk: (c: StreamChunk) => void): void {
    if (!token) return
    const safe = this.toolFilter.feed(token)
    if (!safe) return
    const { uiText, thinkingText } = this.thinking.feed(safe)
    if (thinkingText) onChunk({ thinking: thinkingText })
    if (uiText) onChunk({ token: uiText })
  }

  flush(onChunk: (c: StreamChunk) => void): void {
    const remaining = this.toolFilter.flush()
    if (remaining) {
      const { uiText, thinkingText } = this.thinking.feed(remaining)
      if (thinkingText) onChunk({ thinking: thinkingText })
      if (uiText) onChunk({ token: uiText })
    }
    const tail = this.thinking.flush()
    if (tail.thinkingText) onChunk({ thinking: tail.thinkingText })
    if (tail.uiText) onChunk({ token: tail.uiText })
  }

  sanitizeContent(raw: string): string {
    const noTools = raw
      .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
      .replace(/<\s*function\s*=\s*\w+[\s\S]*?<\s*\/\s*function\s*>/g, '')
      .replace(/<\s*\/\s*tool_call\s*>/g, '')
      .replace(/<\s*\/\s*function\s*>/g, '')
    const { content, thinking } = splitThinkingTags(noTools)
    return fallbackToThinkingIfEmpty(content.trimEnd(), thinking)
  }
}

/** ollama 등 텍스트에 XML 도구호출이 섞여오는 모델용 처리기 (thinking 태그도 함께 분리) */
export class XmlFilteringStreamProcessor implements StreamProcessor {
  private readonly toolFilter = new TextToolCallFilter()
  private readonly thinking = new ThinkingTagFilter()

  feedText(token: string, onChunk: (c: StreamChunk) => void): void {
    // 1차: tool_call XML 제거
    const safe = this.toolFilter.feed(token)
    if (!safe) return
    // 2차: thinking 태그 분리
    const { uiText, thinkingText } = this.thinking.feed(safe)
    if (thinkingText) onChunk({ thinking: thinkingText })
    if (uiText) onChunk({ token: uiText })
  }

  flush(onChunk: (c: StreamChunk) => void): void {
    const remaining = this.toolFilter.flush()
    if (remaining) {
      const { uiText, thinkingText } = this.thinking.feed(remaining)
      if (thinkingText) onChunk({ thinking: thinkingText })
      if (uiText) onChunk({ token: uiText })
    }
    const tail = this.thinking.flush()
    if (tail.thinkingText) onChunk({ thinking: tail.thinkingText })
    if (tail.uiText) onChunk({ token: tail.uiText })
  }

  get extractedToolCalls(): ToolCall[] {
    return this.toolFilter.parsedToolCalls
  }

  sanitizeContent(raw: string): string {
    const noTools = raw
      .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
      .replace(/<\s*function\s*=\s*\w+[\s\S]*?<\s*\/\s*function\s*>/g, '')
      .replace(/<\s*\/\s*tool_call\s*>/g, '')
      .replace(/<\s*\/\s*function\s*>/g, '')
    const { content, thinking } = splitThinkingTags(noTools)
    return fallbackToThinkingIfEmpty(content.trimEnd(), thinking)
  }
}
