import { z } from 'zod'
import { readFile, writeFile } from 'fs/promises'
import { registerTool } from './registry.js'
import { generateUnifiedDiff } from '../utils/diff.js'
import { resolveSecurePath } from '../utils/path.js'
import { makeLogger } from '../utils/logger.js'
import type { HostAdapter } from '../host/interface.js'

const log = makeLogger('edit_file.ts')

const argsSchema = z.object({
  path: z.string().describe('편집할 파일 경로'),
  old_string: z.string().optional().describe('교체 대상 기존 코드 블록 (정확 매칭). startLine/endLine 사용 시 불필요'),
  new_string: z.string().describe('교체할 새 코드 블록'),
  replace_all: z.boolean().optional().default(false).describe('true면 모든 매칭을 교체, false면 첫 번째만'),
  startLine: z.number().optional().describe('교체 시작 라인 (1-indexed, read_file 출력 번호 기준)'),
  endLine: z.number().optional().describe('교체 종료 라인 (1-indexed, 포함)'),
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
      description: `파일의 특정 부분을 정밀하게 편집합니다. 두 가지 방식을 지원합니다.

[방식 1] 라인 번호 방식 (권장): startLine + endLine + new_string
- read_file 출력의 라인 번호를 그대로 사용하세요.
- old_string 매칭 오류 없이 안정적으로 동작합니다.

[방식 2] old_string 방식: old_string + new_string
- old_string은 파일 내용과 정확히 일치해야 합니다 (공백/들여쓰기 포함).
- old_string은 최소 범위로 지정하세요. 메서드/블록 하나씩 별도 호출로 처리하고, 파일 전체나 클래스 전체를 old_string으로 사용하지 마세요.
- 여러 메서드를 삭제·수정할 때는 edit_file을 메서드당 한 번씩 호출하세요.
- 정확한 매칭을 위해 2-3줄의 주변 코드를 포함하세요.

공통 주의사항:
- 반드시 먼저 read_file로 파일을 읽은 후 사용하세요.
- 새 파일 생성이나 전체 재작성은 write_file을 사용하세요.`,
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '파일 경로' },
          old_string: { type: 'string', description: '교체 대상 기존 코드 (정확 매칭). 라인 번호 방식 사용 시 불필요' },
          new_string: { type: 'string', description: '교체할 새 코드' },
          replace_all: { type: 'boolean', description: '모든 매칭 교체 여부 (기본: false, old_string 방식에만 적용)' },
          startLine: { type: 'number', description: '교체 시작 라인 (1-indexed, read_file 출력 번호 기준)' },
          endLine: { type: 'number', description: '교체 종료 라인 (1-indexed, 포함)' },
        },
        required: ['path', 'new_string'],
      },
    },
    category: 'write',
    concurrencySafe: false,
    preview: async (rawArgs, host) => {
      const args = argsSchema.parse(rawArgs)
      const absPath = resolveSecurePath(args.path, host.getProjectRoot())
      try {
        const currentContent = await readFile(absPath, 'utf-8')
        let newContent: string | undefined

        if (args.startLine != null && args.endLine != null) {
          const lines = currentContent.split('\n')
          newContent = [
            ...lines.slice(0, args.startLine - 1),
            args.new_string,
            ...lines.slice(args.endLine),
          ].join('\n')
        } else if (args.old_string != null) {
          const occurrences = countOccurrences(currentContent, args.old_string)
          if (occurrences === 0) return {}
          if (args.replace_all) {
            newContent = currentContent.split(args.old_string).join(args.new_string)
          } else {
            const idx = currentContent.indexOf(args.old_string)
            newContent = currentContent.slice(0, idx) + args.new_string + currentContent.slice(idx + args.old_string.length)
          }
        }

        if (newContent == null) return {}
        return { diff: generateUnifiedDiff(args.path, currentContent, newContent) }
      } catch {
        return {}
      }
    },
  },
  async (rawArgs, host: HostAdapter) => {
    const args = argsSchema.parse(rawArgs)
    const absPath = resolveSecurePath(args.path, host.getProjectRoot())

    log.info({ path: args.path, absPath, mode: args.startLine != null ? 'line-range' : 'old_string' }, '[edit_file] 시작')

    // 현재 파일 내용 읽기
    let currentContent: string
    try {
      currentContent = await readFile(absPath, 'utf-8')
      log.debug({ path: args.path, contentLength: currentContent.length }, '[edit_file] 파일 읽기 성공')
    } catch (e) {
      log.error({ path: args.path, error: (e as Error).message }, '[edit_file] 파일 읽기 실패')
      return { error: `파일을 찾을 수 없습니다: ${args.path}` }
    }

    // Stale-write guard: read_file로 읽은 후 외부에서 변경되었는지 확인
    const cached = readCache.get(absPath)

    if (!cached) {
      log.warn({ path: args.path }, '[edit_file] read_file 없이 직접 호출됨')
      return {
        error: 'edit_file 사용 전 반드시 read_file로 파일을 먼저 읽어야 합니다.',
        hint: 'read_file을 호출해 파일 내용을 먼저 읽고, 그 후 edit_file을 사용하세요.',
      }
    }

    const cacheAge = Date.now() - cached.timestamp
    if (cacheAge > CACHE_TTL_MS) {
      log.warn({ path: args.path, cacheAgeMs: cacheAge, ttlMs: CACHE_TTL_MS }, '[edit_file] 캐시 TTL 초과')
      readCache.delete(absPath)
      return {
        error: '캐시가 만료되었습니다. read_file로 파일을 다시 읽어주세요.',
        stale: true,
      }
    }

    if (cached.content !== currentContent) {
      log.warn({ path: args.path }, '[edit_file] 외부 파일 수정 감지')
      readCache.set(absPath, { content: currentContent, timestamp: Date.now() })
      return {
        error: '파일이 마지막 read_file 이후 변경되었습니다. 다시 read_file로 읽어주세요.',
        stale: true,
      }
    }

    log.debug({ path: args.path }, '[edit_file] guard 검사 통과')

    // ── 방식 1: 라인 번호 기반 교체 ──
    if (args.startLine != null && args.endLine != null) {
      const lines = currentContent.split('\n')
      if (args.startLine < 1 || args.endLine > lines.length || args.startLine > args.endLine) {
        return { error: `라인 번호 범위 오류: 파일은 ${lines.length}줄입니다. (startLine=${args.startLine}, endLine=${args.endLine})` }
      }
      log.info({ path: args.path, startLine: args.startLine, endLine: args.endLine }, '[edit_file] 라인 번호 방식 교체')
      await host.triggerSafetySnapshot(absPath)
      const newContent = [
        ...lines.slice(0, args.startLine - 1),
        args.new_string,
        ...lines.slice(args.endLine),
      ].join('\n')
      await writeFile(absPath, newContent, 'utf-8')
      readCache.set(absPath, { content: newContent, timestamp: Date.now() })
      const diff = generateUnifiedDiff(args.path, currentContent, newContent)
      const linesChanged = diff.split('\n').filter(l => l.startsWith('+') || l.startsWith('-')).length
      log.info({ path: args.path, linesChanged }, '[edit_file] 완료 (라인 번호 방식)')
      return { path: args.path, replacements: 1, diff, linesChanged }
    }

    // ── 방식 2: old_string 매칭 ──
    if (args.old_string == null) {
      return { error: 'startLine/endLine 또는 old_string 중 하나를 반드시 제공해야 합니다.' }
    }

    const oldStr = args.old_string
    const occurrences = countOccurrences(currentContent, oldStr)
    log.debug({ path: args.path, occurrences, oldStringLength: oldStr.length }, '[edit_file] 매칭 개수')

    if (occurrences === 0) {
      const oldFirstLine = oldStr.split('\n')[0]
      log.warn({
        path: args.path,
        oldStringLength: oldStr.length,
        oldStringLines: oldStr.split('\n').length,
        oldStringPreview: oldStr.slice(0, 300),
        hasCRLF: oldStr.includes('\r\n'),
        hasTrailingSpace: oldStr.split('\n').some(l => l !== l.trimEnd()),
        fileHasCRLF: currentContent.includes('\r\n'),
        firstLineFoundInFile: currentContent.includes(oldFirstLine),
        firstLineTrimFoundInFile: currentContent.includes(oldFirstLine.trim()),
      }, '[edit_file] old_string 매칭 실패 진단')

      const { result: fallback, diagnostics } = tryNormalizedMatch(currentContent, oldStr, args.new_string, args.replace_all ?? false)
      log.warn({ path: args.path, diagnostics }, '[edit_file] 폴백 전략 결과')

      if (fallback) {
        log.info({ path: args.path, strategy: fallback.strategy }, '[edit_file] 정규화 폴백으로 매칭 성공')
        await host.triggerSafetySnapshot(absPath)
        await writeFile(absPath, fallback.newContent, 'utf-8')
        readCache.set(absPath, { content: fallback.newContent, timestamp: Date.now() })
        const diff = generateUnifiedDiff(args.path, currentContent, fallback.newContent)
        const linesChanged = diff.split('\n').filter(l => l.startsWith('+') || l.startsWith('-')).length
        log.info({ path: args.path, linesChanged, strategy: fallback.strategy }, '[edit_file] 완료 (폴백)')
        return { path: args.path, replacements: 1, diff, linesChanged, fallbackStrategy: fallback.strategy }
      }

      log.warn({ path: args.path }, '[edit_file] old_string을 찾을 수 없음')
      const nearestLines = findNearestLines(currentContent, oldStr)
      log.warn({
        oldFirstLine,
        oldFirstLineCharCodes: [...oldFirstLine].slice(0, 20).map(c => c.charCodeAt(0)),
        nearestFileLine: nearestLines?.split('\n')[0] ?? '(없음)',
      }, '[edit_file] old_string 첫 줄 비교')

      return {
        error: 'old_string을 파일에서 찾을 수 없습니다. 공백/들여쓰기를 포함하여 정확히 입력하세요.',
        hint: 'read_file로 파일을 다시 읽고 정확한 코드 블록을 확인하세요. 또는 startLine/endLine 방식을 사용하세요.',
        ...(nearestLines ? { nearestMatch: nearestLines } : {}),
      }
    }
    if (occurrences > 1 && !args.replace_all) {
      log.warn({ path: args.path, occurrences }, '[edit_file] 중복 매칭')
      return {
        error: `old_string이 ${occurrences}개 매칭됩니다. replace_all: true로 모두 교체하거나 더 많은 주변 코드를 포함하세요.`,
        occurrences,
      }
    }

    await host.triggerSafetySnapshot(absPath)
    log.debug({ path: args.path }, '[edit_file] safety snapshot 생성')

    let newContent: string
    if (args.replace_all) {
      log.info({ path: args.path, occurrences }, '[edit_file] 전체 교체 실행')
      newContent = currentContent.split(oldStr).join(args.new_string)
    } else {
      log.info({ path: args.path }, '[edit_file] 첫 번째 매칭만 교체')
      const idx = currentContent.indexOf(oldStr)
      newContent = currentContent.slice(0, idx) + args.new_string + currentContent.slice(idx + oldStr.length)
    }

    try {
      await writeFile(absPath, newContent, 'utf-8')
      log.info({ path: args.path, newContentLength: newContent.length }, '[edit_file] 파일 쓰기 성공')
    } catch (e) {
      log.error({ path: args.path, error: (e as Error).message }, '[edit_file] 파일 쓰기 실패')
      throw e
    }

    readCache.set(absPath, { content: newContent, timestamp: Date.now() })

    const diff = generateUnifiedDiff(args.path, currentContent, newContent)
    const linesChanged = diff.split('\n').filter(l => l.startsWith('+') || l.startsWith('-')).length
    log.info({ path: args.path, linesChanged, replacements: args.replace_all ? occurrences : 1 }, '[edit_file] 완료')

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
): { result: { newContent: string; strategy: string } | null; diagnostics: string[] } {
  const strategies: Array<{ name: string; normalize: (s: string) => string }> = [
    { name: 'crlf', normalize: s => s.replace(/\r\n/g, '\n') },
    { name: 'trailing-whitespace', normalize: s => s.replace(/\r\n/g, '\n').split('\n').map(l => l.trimEnd()).join('\n') },
  ]

  const diagnostics: string[] = []

  for (const { name, normalize } of strategies) {
    const normContent = normalize(content)
    const normOld = normalize(oldStr)
    const normNew = normalize(newStr)

    if (!normContent.includes(normOld)) {
      diagnostics.push(`${name}: not matched`)
      continue
    }

    diagnostics.push(`${name}: matched`)
    let newContent: string
    if (replaceAll) {
      newContent = normContent.split(normOld).join(normNew)
    } else {
      const idx = normContent.indexOf(normOld)
      newContent = normContent.slice(0, idx) + normNew + normContent.slice(idx + normOld.length)
    }
    return { result: { newContent, strategy: name }, diagnostics }
  }
  return { result: null, diagnostics }
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
