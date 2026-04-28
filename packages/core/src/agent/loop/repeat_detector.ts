/**
 * 동일 도구 반복 호출 감지 — 환각이 일으키는 가장 흔한 안티패턴.
 *
 * 임계:
 *   - hint 회수: 부드러운 system hint 주입 (대안 도구 권유)
 *   - block 회수: 해당 도구를 disabledTools 에 추가 → loop 가 silent skip + 종결 hint
 */

import type { ToolCall, Message } from '../../providers/types.js'
import { LOOP_TUNING } from '../tuning.js'
import { makeLogger } from '../../utils/logger.js'

const log = makeLogger('repeat_detector.ts')

const HINT_AT = LOOP_TUNING.repeatHint
const BLOCK_AT = LOOP_TUNING.repeatBlock

export class RepeatToolDetector {
  private lastTool: string | null = null
  private consecutive = 0
  readonly disabledTools = new Set<string>()

  /** 한 turn 의 tool_calls 를 관찰하고, 주입할 hint 메시지를 반환한다. */
  observe(calls: ToolCall[]): { hints: Message[]; consecutiveSameTool: boolean } {
    const names = calls.map(c => c.function.name)
    const unique = new Set(names)
    let consecutiveSameTool = false

    if (unique.size === 1) {
      const name = names[0]
      if (name === this.lastTool) {
        this.consecutive += names.length
        consecutiveSameTool = true
      } else {
        this.lastTool = name
        this.consecutive = names.length
      }
    } else {
      // 한 turn 안에 서로 다른 도구가 섞이면 정상 — 카운터 리셋
      this.lastTool = null
      this.consecutive = 0
    }

    const hints: Message[] = []
    if (this.lastTool && this.consecutive >= BLOCK_AT && !this.disabledTools.has(this.lastTool)) {
      this.disabledTools.add(this.lastTool)
      log.warn(`동일 도구 ${this.consecutive}회 — 차단 (tool=${this.lastTool})`)
      hints.push({
        role: 'system',
        content: `[Repeat Block] 도구 '${this.lastTool}' 가 ${this.consecutive}회 연속 호출되어 차단되었습니다. **다음 응답에서는 도구를 호출하지 말고**, 지금까지 모은 정보로 사용자에게 답변을 작성하세요. 정말 추가 정보가 필요하면 다른 도구로 전환.`,
      })
    } else if (this.lastTool && this.consecutive === HINT_AT) {
      log.warn(`반복 hint: ${this.lastTool} ${this.consecutive}회`)
      hints.push({
        role: 'system',
        content: `[Repeat Hint] 같은 도구('${this.lastTool}')를 ${this.consecutive}회 연속 사용 중입니다. ${altSuggest(this.lastTool)} 로 한 번에 더 많은 정보를 얻거나, 정보가 충분하면 답변을 작성하세요.`,
      })
    }

    return { hints, consecutiveSameTool }
  }
}

function altSuggest(tool: string): string {
  if (tool === 'list_dir') return "glob_tool('**/*.{ts,kt,...}') 또는 run_terminal('find ...')"
  if (tool === 'read_file') return 'grep_tool 로 위치 파악 후 startLine/endLine 으로 범위 제한'
  if (tool === 'grep_tool') return 'glob_tool 로 후보 파일을 좁힌 다음 read_file'
  return '다른 도구(glob_tool / grep_tool / run_terminal)'
}
