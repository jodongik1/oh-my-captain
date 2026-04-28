/**
 * `<thinking>...</thinking>` 텍스트 블록 필터.
 *
 * 시스템 프롬프트가 모델에게 도구 호출 직전 사고를 `<thinking>` 태그 안에 작성하도록 요구하는데,
 * 그 내용이 UI 스트림에 그대로 노출되면 사용자가 raw XML 태그를 보게 된다 (환각 메시지처럼 보임).
 *
 * 이 필터는 스트리밍 도중:
 *   - `<thinking>` 시작 태그가 들어오면 그 시점부터 UI 로의 토큰 emit 을 중단
 *   - 내부 내용은 별도 콜백(onThinking)으로 흘려보내 IDE 의 thinking 인디케이터에 사용
 *   - `</thinking>` 닫힘 태그를 만나면 다시 UI 로 emit 재개
 *
 * 부분 매칭(예: `<th` 만 들어온 경우)에 대해서도 안전하도록 pending 버퍼를 유지한다.
 *
 * 닫히지 않은 채 스트림이 끝나면 안에 있던 내용은 전부 버린다 — 모델이 깜빡한 것이지 사용자가 볼 내용이 아니다.
 */

import { makeLogger } from '../utils/logger.js'

const log = makeLogger('thinking_tag_filter.ts')

const OPEN_TAG = '<thinking>'
const CLOSE_TAG = '</thinking>'
const OPEN_PREFIXES: string[] = []
for (let i = 1; i < OPEN_TAG.length; i++) OPEN_PREFIXES.push(OPEN_TAG.slice(0, i))
const CLOSE_PREFIXES: string[] = []
for (let i = 1; i < CLOSE_TAG.length; i++) CLOSE_PREFIXES.push(CLOSE_TAG.slice(0, i))

export class ThinkingTagFilter {
  /** UI emit 을 위해 보류 중인 텍스트(부분 태그일 수 있음) */
  private pending = ''
  /** thinking 블록 안의 누적 텍스트 (onThinking 콜백 호출 후 비움) */
  private inside = false

  /**
   * 토큰을 받아 UI 에 표시할 안전한 텍스트와 thinking 본문을 분리한다.
   * @returns { uiText, thinkingText } — uiText 는 사용자에게 보여줄 부분, thinkingText 는 thinking 채널로 흘릴 부분
   */
  feed(token: string): { uiText: string; thinkingText: string } {
    let uiText = ''
    let thinkingText = ''
    let buf = this.pending + token
    this.pending = ''

    while (buf.length > 0) {
      if (this.inside) {
        const closeIdx = buf.indexOf(CLOSE_TAG)
        if (closeIdx !== -1) {
          // thinking 종료
          thinkingText += buf.slice(0, closeIdx)
          buf = buf.slice(closeIdx + CLOSE_TAG.length)
          this.inside = false
          continue
        }
        // 닫힘 태그가 부분 매칭 가능성 — 끝부분이 </thinking 의 prefix 일 수 있음
        const partial = endsWithPartial(buf, CLOSE_PREFIXES)
        if (partial > 0) {
          const safe = buf.length - partial
          if (safe > 0) thinkingText += buf.slice(0, safe)
          this.pending = buf.slice(safe)
        } else {
          thinkingText += buf
        }
        buf = ''
        break
      }

      // 바깥 — 시작 태그 검색
      const openIdx = buf.indexOf(OPEN_TAG)
      if (openIdx !== -1) {
        if (openIdx > 0) uiText += buf.slice(0, openIdx)
        buf = buf.slice(openIdx + OPEN_TAG.length)
        this.inside = true
        log.debug('thinking 블록 시작 감지')
        continue
      }
      // 끝부분이 <thinking 의 prefix 일 수 있음
      const partial = endsWithPartial(buf, OPEN_PREFIXES)
      if (partial > 0) {
        const safe = buf.length - partial
        if (safe > 0) uiText += buf.slice(0, safe)
        this.pending = buf.slice(safe)
      } else {
        uiText += buf
      }
      buf = ''
      break
    }

    return { uiText, thinkingText }
  }

  /**
   * 스트림 종료 후 호출. 닫히지 않은 thinking 블록은 폐기, 보류된 일반 pending 만 반환.
   */
  flush(): { uiText: string; thinkingText: string } {
    if (this.inside) {
      log.warn(`thinking 블록이 닫히지 않은 채 스트림 종료 — 내부 내용 폐기 (len=${this.pending.length})`)
      this.pending = ''
      this.inside = false
      return { uiText: '', thinkingText: '' }
    }
    const ui = this.pending
    this.pending = ''
    return { uiText: ui, thinkingText: '' }
  }
}

function endsWithPartial(text: string, prefixes: string[]): number {
  for (const p of prefixes) {
    if (text.endsWith(p)) return p.length
  }
  return 0
}

/**
 * raw content 에서 `<thinking>...</thinking>` 블록을 분리해 본문/사고 두 부분을 동시에 반환한다.
 * - 닫히지 않은 채 끝나는 마지막 `<thinking>...$` 도 본문에서 제거하면서 그 내부를 thinking 으로 캡처.
 *
 * 사용 예:
 *   const { content, thinking } = splitThinkingTags(raw)
 *   // 모델이 답변 전체를 thinking 안에 써버려 content 가 비면 thinking 으로 폴백.
 */
export function splitThinkingTags(raw: string): { content: string; thinking: string } {
  let content = raw
  const thinkingParts: string[] = []

  // 닫힌 thinking 블록들 추출
  content = content.replace(/<thinking>([\s\S]*?)<\/thinking>/g, (_, inner: string) => {
    thinkingParts.push(inner)
    return ''
  })

  // 닫히지 않고 끝까지 가는 마지막 thinking 추출 (`<thinking>...$`)
  content = content.replace(/<thinking>([\s\S]*)$/g, (_, inner: string) => {
    thinkingParts.push(inner)
    return ''
  })

  return {
    content: content.trimStart(),
    thinking: thinkingParts.join('\n\n').trim(),
  }
}

/** 누적된 raw content 에서 thinking 블록을 제거. (기존 호출자 호환용 — splitThinkingTags 의 content 만 반환) */
export function stripThinkingTags(raw: string): string {
  return splitThinkingTags(raw).content
}
