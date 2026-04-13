import { readFile } from 'fs/promises'
import { join, dirname } from 'path'
import type { CodeActionPayload, CodeActionType } from '../ipc/protocol.js'
import type { LLMProvider } from '../providers/types.js'
import type { HostAdapter } from '../host/interface.js'

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
 * 프롬프트 템플릿 로드 우선순위:
 * 1. .captain/prompts/{action}.md (사용자 커스터마이징)
 * 2. 내장 기본 템플릿
 */
async function loadPromptTemplate(
  action: CodeActionType, projectRoot: string
): Promise<string> {
  const fileName = ACTION_FILES[action]
  const customPath = join(projectRoot, '.captain', 'prompts', fileName)
  try {
    return await readFile(customPath, 'utf-8')
  } catch {
    return await readFile(join(DEFAULT_PROMPTS_DIR, fileName), 'utf-8')
  }
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
  host: HostAdapter
): Promise<void> {
  const template = await loadPromptTemplate(payload.action, host.getProjectRoot())
  const prompt = renderTemplate(template, payload, host.getProjectRoot())

  host.emit('stream_chunk', { token: '' })

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
      if (chunk.token) host.emit('stream_chunk', { token: chunk.token })
    }
  )

  host.emit('stream_end', {})

  // improve 액션의 경우 응답에서 코드 블록을 추출하여 diff 표시
  if (payload.action === 'improve' && response.content) {
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
}

function extractCodeFromResponse(content: string): string {
  const match = content.match(/```[\w]*\n([\s\S]*?)```/)
  return match ? match[1].trim() : ''
}
