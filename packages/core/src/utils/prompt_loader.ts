/**
 * 프롬프트 템플릿 로더.
 *
 * 로드 우선순위:
 * 1. .captain/prompts/{fileName} — 사용자 커스터마이징
 * 2. 번들 내장 기본값 (bundledDir)
 */

import { readFile } from 'fs/promises'
import { join } from 'path'

/**
 * 프롬프트 파일을 우선순위에 따라 로드합니다.
 *
 * @param fileName     프롬프트 파일명 (예: 'system_prompt.md', 'explain.md')
 * @param projectRoot  프로젝트 루트 경로
 * @param bundledDir   번들에 내장된 기본 프롬프트 디렉토리 경로
 */
export async function loadPrompt(
  fileName: string,
  projectRoot: string,
  bundledDir: string
): Promise<string> {
  const customPath = join(projectRoot, '.captain', 'prompts', fileName)
  try {
    return await readFile(customPath, 'utf-8')
  } catch {
    return await readFile(join(bundledDir, fileName), 'utf-8')
  }
}
