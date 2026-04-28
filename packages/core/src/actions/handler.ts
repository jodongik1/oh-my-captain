import { join } from 'path'
import { loadPrompt } from '../utils/prompt_loader.js'
import type { CodeActionPayload, CodeActionType } from '@omc/protocol'
import type { LLMProvider } from '../providers/types.js'
import type { HostAdapter } from '../host/interface.js'
import { makeLogger } from '../utils/logger.js'

const log = makeLogger('code_action.ts')

// CJS 번들에서는 __dirname이 자동 제공됨. ESM fallback 불필요.
// (esbuild format: 'cjs' → __dirname 사용 가능)

// 기본 프롬프트 경로
const DEFAULT_PROMPTS_DIR = join(__dirname, 'prompts')

const ACTION_FILES: Record<CodeActionType, string> = {
  explain: 'explain.md',
  review: 'review.md',
  impact: 'impact.md',
  query_validation: 'query_validation.md',
  improve: 'improve.md',
  generate_test: 'generate_test.md',
}

/**
 * 프롬프트 템플릿 로드 — 공통 loadPrompt 사용
 */
async function loadActionPrompt(
  action: CodeActionType, projectRoot: string
): Promise<string> {
  const fileName = ACTION_FILES[action]
  return loadPrompt(fileName, projectRoot, DEFAULT_PROMPTS_DIR)
}

/**
 * 템플릿 변수를 실제 값으로 치환
 */
function renderTemplate(template: string, payload: CodeActionPayload, projectRoot: string): string {
  return template
    .replace(/\{\{code\}\}/g, payload.code)
    .replace(/\{\{filePath\}\}/g, payload.filePath)
    .replace(/\{\{language\}\}/g, payload.language)
    .replace(/\{\{lineRange\}\}/g,
      payload.lineRange ? `L${payload.lineRange.start}-L${payload.lineRange.end}` : '전체 파일'
    )
    .replace(/\{\{projectRoot\}\}/g, projectRoot)
}

/**
 * 코드 액션 실행 → 프롬프트 렌더링 → LLM 호출 → 스트리밍 응답
 */
export async function executeCodeAction(
  payload: CodeActionPayload,
  provider: LLMProvider,
  host: HostAdapter,
  signal?: AbortSignal
): Promise<void> {
  const template = await loadActionPrompt(payload.action, host.getProjectRoot())
  const prompt = renderTemplate(template, payload, host.getProjectRoot())

  const promptChars = prompt.length
  const approxPromptTokens = Math.ceil(promptChars / 4)
  log.info({ action: payload.action, filePath: payload.filePath, lineRange: payload.lineRange, promptChars, approxPromptTokens }, '[Action] 스트림 시작')

  // 이미 abort 된 상태로 진입한 경우 stream 자체를 시작하지 않는다.
  // (race: 사용자가 액션 직후 즉시 중단 누른 경우)
  if (signal?.aborted) {
    host.emit('turn_done', {})
    return
  }

  host.emit('stream_start', { source: 'action' })

  let chunkCount = 0
  let responseChars = 0

  try {
    const response = await provider.stream(
      [
        {
          role: 'system',
          content: 'You are a code analysis assistant. Follow the response format specified in the prompt exactly. Respond in Korean unless the code comments are in another language.'
        },
        { role: 'user', content: prompt }
      ],
      [],  // 도구 없음 (분석만)
      (chunk) => {
        if (signal?.aborted) return
        if (chunk.token) {
          chunkCount++
          responseChars += chunk.token.length
          host.emit('stream_chunk', { token: chunk.token })
        }
      },
      signal
    )

    log.info({ action: payload.action, chunkCount, responseChars, approxResponseTokens: Math.ceil(responseChars / 4) }, '[Action] 스트림 완료')

    // improve 액션의 경우 응답에서 코드 블록을 추출하여 diff 표시
    if (!signal?.aborted && payload.action === 'improve' && response.content) {
      const improved = extractCodeFromResponse(response.content)
      if (improved && improved !== payload.code) {
        host.emit('tool_result', {
          tool: 'edit_file',
          result: {
            path: payload.filePath,
            before: payload.code,
            after: improved,
            action: 'improve'
          }
        })
      }
    }
  } catch (e: any) {
    // abort 로 인한 종료는 사용자에게 에러 메시지를 보여주지 않는다.
    if (!signal?.aborted) {
      const isTimeout = e?.code === 'TIMEOUT'
      log.error({ action: payload.action, error: e?.message, isTimeout }, '[Action] 스트림 오류')
      host.emit('stream_chunk', { token: `\n\n---\n⚠️ **${e?.message ?? '알 수 없는 오류가 발생했습니다.'}**` })
    }
  } finally {
    // 정상 종료 / 에러 / abort 모두에서 stream_end 와 turn_done 을 보장 emit.
    // turn_done 이 없으면 webview 의 isBusy 가 영원히 true 로 남아 입력창이 stop 상태로 고정된다.
    host.emit('stream_end', {})
    host.emit('turn_done', {})
  }
}

function extractCodeFromResponse(content: string): string {
  const match = content.match(/```[\w]*\n([\s\S]*?)```/)
  return match ? match[1].trim() : ''
}
