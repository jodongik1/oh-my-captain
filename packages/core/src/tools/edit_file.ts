import { z } from 'zod'
import { readFile, writeFile } from 'fs/promises'
import { join, isAbsolute } from 'path'
import { registerTool } from './registry.js'
import { generateUnifiedDiff } from '../utils/diff.js'
import { logger } from '../utils/logger.js'
import type { HostAdapter } from '../host/interface.js'

const argsSchema = z.object({
  path: z.string().describe('편집할 파일 경로'),
  old_string: z.string().describe('교체 대상 기존 코드 블록 (정확 매칭)'),
  new_string: z.string().describe('교체할 새 코드 블록'),
  replace_all: z.boolean().optional().default(false).describe('true면 모든 매칭을 교체, false면 첫 번째만'),
})

// 최근 read된 파일을 추적하는 stale-write guard
const CACHE_TTL_MS = 5 * 60 * 1000  // 5분 TTL
const readCache = new Map<string, { content: string; timestamp: number }>()

/** read_file이 호출될 때 캐시에 기록 (외부에서 호출) */
export function markFileRead(absPath: string, content: string) {
  readCache.set(absPath, { content, timestamp: Date.now() })
}

registerTool(
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: `파일의 특정 부분을 정밀하게 편집합니다. old_string을 찾아 new_string으로 교체합니다.
주의:
- 반드시 먼저 read_file로 파일을 읽은 후 사용하세요.
- old_string은 파일 내용과 정확히 일치해야 합니다 (공백/들여쓰기 포함).
- 정확한 매칭을 위해 2-3줄의 주변 코드를 포함하세요.
- 새 파일 생성이나 전체 재작성은 write_file을 사용하세요.`,
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '파일 경로' },
          old_string: { type: 'string', description: '교체 대상 기존 코드 (정확 매칭)' },
          new_string: { type: 'string', description: '교체할 새 코드' },
          replace_all: { type: 'boolean', description: '모든 매칭 교체 여부 (기본: false)' },
        },
        required: ['path', 'old_string', 'new_string'],
      },
    },
    category: 'write',
    concurrencySafe: false,
    preview: async (rawArgs, host) => {
      const args = argsSchema.parse(rawArgs)
      const absPath = isAbsolute(args.path) ? args.path : join(host.getProjectRoot(), args.path)
      try {
        const currentContent = await readFile(absPath, 'utf-8')
        const occurrences = countOccurrences(currentContent, args.old_string)
        if (occurrences === 0) return {}
        let newContent: string
        if (args.replace_all) {
          newContent = currentContent.split(args.old_string).join(args.new_string)
        } else {
          const idx = currentContent.indexOf(args.old_string)
          newContent = currentContent.slice(0, idx) + args.new_string + currentContent.slice(idx + args.old_string.length)
        }
        return { diff: generateUnifiedDiff(args.path, currentContent, newContent) }
      } catch {
        return {}
      }
    },
  },
  async (rawArgs, host: HostAdapter) => {
    const args = argsSchema.parse(rawArgs)
    const absPath = isAbsolute(args.path)
      ? args.path
      : join(host.getProjectRoot(), args.path)

    logger.info({ path: args.path, absPath, replace_all: args.replace_all }, '[edit_file] 시작')

    // 현재 파일 내용 읽기
    let currentContent: string
    try {
      currentContent = await readFile(absPath, 'utf-8')
      logger.debug({ path: args.path, contentLength: currentContent.length }, '[edit_file] 파일 읽기 성공')
    } catch (e) {
      logger.error({ path: args.path, error: (e as Error).message }, '[edit_file] 파일 읽기 실패')
      return { error: `파일을 찾을 수 없습니다: ${args.path}` }
    }

    // Stale-write guard: read_file로 읽은 후 외부에서 변경되었는지 확인
    const cached = readCache.get(absPath)

    // read_file을 먼저 호출했는지 확인
    if (!cached) {
      logger.warn({ path: args.path }, '[edit_file] read_file 없이 직접 호출됨')
      return {
        error: 'edit_file 사용 전 반드시 read_file로 파일을 먼저 읽어야 합니다.',
        hint: 'read_file을 호출해 파일 내용을 먼저 읽고, 그 후 edit_file을 사용하세요.',
      }
    }

    // TTL 초과 확인
    const cacheAge = Date.now() - cached.timestamp
    if (cacheAge > CACHE_TTL_MS) {
      logger.warn({ path: args.path, cacheAgeMs: cacheAge, ttlMs: CACHE_TTL_MS }, '[edit_file] 캐시 TTL 초과')
      readCache.delete(absPath)
      return {
        error: '캐시가 만료되었습니다. read_file로 파일을 다시 읽어주세요.',
        stale: true,
      }
    }

    // 외부 수정 감지
    if (cached.content !== currentContent) {
      logger.warn({ path: args.path }, '[edit_file] 외부 파일 수정 감지')
      readCache.set(absPath, { content: currentContent, timestamp: Date.now() })
      return {
        error: '파일이 마지막 read_file 이후 변경되었습니다. 다시 read_file로 읽어주세요.',
        stale: true,
      }
    }

    logger.debug({ path: args.path }, '[edit_file] guard 검사 통과')

    // old_string 매칭 검증
    const occurrences = countOccurrences(currentContent, args.old_string)
    logger.debug({ path: args.path, occurrences, oldStringLength: args.old_string.length }, '[edit_file] 매칭 개수')

    if (occurrences === 0) {
      // A. 정규화 폴백: \r\n 정규화 → trailing whitespace 제거 순으로 재시도
      const fallback = tryNormalizedMatch(currentContent, args.old_string, args.new_string, args.replace_all ?? false)
      if (fallback) {
        logger.info({ path: args.path, strategy: fallback.strategy }, '[edit_file] 정규화 폴백으로 매칭 성공')
        await host.triggerSafetySnapshot(absPath)
        await writeFile(absPath, fallback.newContent, 'utf-8')
        readCache.set(absPath, { content: fallback.newContent, timestamp: Date.now() })
        const diff = generateUnifiedDiff(args.path, currentContent, fallback.newContent)
        const linesChanged = diff.split('\n').filter(l => l.startsWith('+') || l.startsWith('-')).length
        logger.info({ path: args.path, linesChanged, strategy: fallback.strategy }, '[edit_file] 완료 (폴백)')
        return { path: args.path, replacements: 1, diff, linesChanged, fallbackStrategy: fallback.strategy }
      }

      // B. 근접 라인 힌트: old_string 첫 줄과 가장 유사한 파일 구간 반환
      logger.warn({ path: args.path }, '[edit_file] old_string을 찾을 수 없음')
      const nearestLines = findNearestLines(currentContent, args.old_string)
      return {
        error: 'old_string을 파일에서 찾을 수 없습니다. 공백/들여쓰기를 포함하여 정확히 입력하세요.',
        hint: 'read_file로 파일을 다시 읽고 정확한 코드 블록을 확인하세요.',
        ...(nearestLines ? { nearestMatch: nearestLines } : {}),
      }
    }
    if (occurrences > 1 && !args.replace_all) {
      logger.warn({ path: args.path, occurrences }, '[edit_file] 중복 매칭')
      return {
        error: `old_string이 ${occurrences}개 매칭됩니다. replace_all: true로 모두 교체하거나 더 많은 주변 코드를 포함하세요.`,
        occurrences,
      }
    }

    // 변경 전 스냅샷
    await host.triggerSafetySnapshot(absPath)
    logger.debug({ path: args.path }, '[edit_file] safety snapshot 생성')

    // 교체 실행
    let newContent: string
    if (args.replace_all) {
      logger.info({ path: args.path, occurrences }, '[edit_file] 전체 교체 실행')
      newContent = currentContent.split(args.old_string).join(args.new_string)
    } else {
      logger.info({ path: args.path }, '[edit_file] 첫 번째 매칭만 교체')
      const idx = currentContent.indexOf(args.old_string)
      newContent = currentContent.slice(0, idx) + args.new_string + currentContent.slice(idx + args.old_string.length)
    }

    try {
      await writeFile(absPath, newContent, 'utf-8')
      logger.info({ path: args.path, newContentLength: newContent.length }, '[edit_file] 파일 쓰기 성공')
    } catch (e) {
      logger.error({ path: args.path, error: (e as Error).message }, '[edit_file] 파일 쓰기 실패')
      throw e
    }

    // 캐시 업데이트
    readCache.set(absPath, { content: newContent, timestamp: Date.now() })

    // diff 생성
    const diff = generateUnifiedDiff(args.path, currentContent, newContent)
    const linesChanged = diff.split('\n').filter(l => l.startsWith('+') || l.startsWith('-')).length

    logger.info({ path: args.path, linesChanged, replacements: args.replace_all ? occurrences : 1 }, '[edit_file] 완료')

    return {
      path: args.path,
      replacements: args.replace_all ? occurrences : 1,
      diff,
      linesChanged,
    }
  }
)

function countOccurrences(text: string, search: string): number {
  let count = 0
  let idx = 0
  while ((idx = text.indexOf(search, idx)) !== -1) {
    count++
    idx += search.length
  }
  return count
}

/** A. 정규화 폴백 매칭: \r\n 정규화 → trailing whitespace 제거 순으로 시도 */
function tryNormalizedMatch(
  content: string,
  oldStr: string,
  newStr: string,
  replaceAll: boolean
): { newContent: string; strategy: string } | null {
  const strategies: Array<{ name: string; normalize: (s: string) => string }> = [
    { name: 'crlf', normalize: s => s.replace(/\r\n/g, '\n') },
    { name: 'trailing-whitespace', normalize: s => s.replace(/\r\n/g, '\n').split('\n').map(l => l.trimEnd()).join('\n') },
  ]

  for (const { name, normalize } of strategies) {
    const normContent = normalize(content)
    const normOld = normalize(oldStr)
    const normNew = normalize(newStr)

    if (!normContent.includes(normOld)) continue

    let newContent: string
    if (replaceAll) {
      newContent = normContent.split(normOld).join(normNew)
    } else {
      const idx = normContent.indexOf(normOld)
      newContent = normContent.slice(0, idx) + normNew + normContent.slice(idx + normOld.length)
    }
    return { newContent, strategy: name }
  }
  return null
}

/** B. old_string 첫 줄과 가장 유사한 파일 구간을 반환 (LLM 재시도 힌트용) */
function findNearestLines(content: string, oldStr: string): string | null {
  const searchFirstLine = oldStr.split('\n')[0].trim()
  if (!searchFirstLine) return null

  const fileLines = content.split('\n')
  const searchLines = oldStr.split('\n')
  const windowSize = searchLines.length

  let bestScore = 0
  let bestIdx = -1

  for (let i = 0; i <= fileLines.length - windowSize; i++) {
    const firstLine = fileLines[i].trim()
    if (!firstLine.includes(searchFirstLine) && !searchFirstLine.includes(firstLine)) continue

    // 첫 줄이 유사한 구간의 전체 유사도 계산
    let score = 0
    for (let j = 0; j < windowSize; j++) {
      if (fileLines[i + j]?.trim() === searchLines[j]?.trim()) score++
    }
    if (score > bestScore) {
      bestScore = score
      bestIdx = i
    }
  }

  if (bestIdx === -1) return null

  const start = Math.max(0, bestIdx - 1)
  const end = Math.min(fileLines.length, bestIdx + windowSize + 1)
  return fileLines.slice(start, end).join('\n')
}
