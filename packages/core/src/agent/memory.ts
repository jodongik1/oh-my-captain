/**
 * 영구 메모리 시스템 — 프로젝트별 MEMORY.md 기반.
 *
 * Claude Code의 CLAUDE.md 패턴을 참고:
 * - 프로젝트 루트의 .captain/MEMORY.md에 저장
 * - 세션 간 유지되는 핵심 정보 (아키텍처 결정, 코드 스타일, 알려진 이슈 등)
 * - 에이전트가 save_memory 도구로 자율적으로 저장
 * - 시스템 프롬프트에 자동 주입
 */

import { readFile, writeFile, mkdir } from 'fs/promises'
import { join, dirname } from 'path'

const MEMORY_FILE = '.captain/MEMORY.md'

export interface MemoryEntry {
  content: string
  timestamp: number
  category: 'architecture' | 'style' | 'issue' | 'convention' | 'general'
}

/**
 * 프로젝트의 MEMORY.md를 로드합니다.
 * 파일이 없으면 빈 문자열을 반환합니다.
 */
export async function loadMemory(projectRoot: string): Promise<string> {
  const memoryPath = join(projectRoot, MEMORY_FILE)
  try {
    return await readFile(memoryPath, 'utf-8')
  } catch {
    return ''
  }
}

/**
 * MEMORY.md에 새 항목을 추가합니다.
 * 기존 내용 뒤에 구분선과 함께 append합니다.
 */
export async function saveMemory(
  projectRoot: string,
  content: string,
  category: MemoryEntry['category'] = 'general'
): Promise<{ saved: boolean; totalEntries: number }> {
  const memoryPath = join(projectRoot, MEMORY_FILE)
  await mkdir(dirname(memoryPath), { recursive: true })

  let existing = ''
  try {
    existing = await readFile(memoryPath, 'utf-8')
  } catch { /* 새 파일 */ }

  const timestamp = new Date().toISOString()
  const header = `## [${category.toUpperCase()}] — ${timestamp}`
  const newEntry = `${header}\n\n${content.trim()}\n`

  const updated = existing
    ? `${existing.trimEnd()}\n\n---\n\n${newEntry}`
    : `# Oh My Captain — Project Memory\n\n> 이 파일은 에이전트가 세션 간 기억해야 할 중요한 정보를 자동 저장합니다.\n> 수동 편집도 가능합니다.\n\n---\n\n${newEntry}`

  await writeFile(memoryPath, updated, 'utf-8')

  // 항목 수 계산
  const totalEntries = (updated.match(/^## \[/gm) || []).length

  return { saved: true, totalEntries }
}

/**
 * MEMORY.md에서 키워드로 관련 항목을 검색합니다.
 * 간단한 텍스트 매칭으로 관련 섹션을 추출합니다.
 */
export function searchMemory(memoryContent: string, query: string): string[] {
  if (!memoryContent || !query) return []

  const sections = memoryContent.split(/^---$/m).map(s => s.trim()).filter(Boolean)
  const queryLower = query.toLowerCase()

  return sections.filter(section =>
    section.toLowerCase().includes(queryLower)
  )
}

/**
 * MEMORY.md의 토큰 수를 추정하고, 너무 크면 최신 항목만 반환합니다.
 * 시스템 프롬프트에 주입 시 컨텍스트 절약용.
 */
export function trimMemoryForContext(
  memoryContent: string,
  maxChars: number = 8000
): string {
  if (memoryContent.length <= maxChars) return memoryContent

  // 최신 항목부터 역순으로 maxChars 이내까지만 포함
  const sections = memoryContent.split(/\n---\n/).reverse()
  const included: string[] = []
  let totalLen = 0

  for (const section of sections) {
    if (totalLen + section.length > maxChars) break
    included.unshift(section)
    totalLen += section.length
  }

  return `(이전 ${sections.length - included.length}개 항목 생략)\n\n---\n\n` + included.join('\n---\n')
}
