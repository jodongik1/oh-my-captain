/**
 * edit_file 의 순수 함수 헬퍼.
 *
 * - IO/로깅/host 호출 없음 → 단위 테스트 직접 가능.
 * - 두 가지 편집 모드(라인 범위 / old_string) 의 핵심 로직과 정규화 폴백, 진단 헬퍼를 모은다.
 */

export interface LineRangeArgs {
  startLine: number
  endLine: number
  new_string: string
}

export interface OldStringArgs {
  old_string: string
  new_string: string
  replace_all: boolean
}

export type EditOutcome =
  | { kind: 'ok'; newContent: string; replacements: number; fallbackStrategy?: string }
  | { kind: 'error'; error: string; hint?: string; nearestMatch?: string; occurrences?: number; stale?: boolean }

/** 문자열 내 search 의 출현 수 카운트 (overlap 없는 단순 검색). */
export function countOccurrences(text: string, search: string): number {
  if (search.length === 0) return 0
  let count = 0
  let idx = 0
  while ((idx = text.indexOf(search, idx)) !== -1) {
    count++
    idx += search.length
  }
  return count
}

/** 라인 번호 범위 기반 교체 (1-indexed, endLine 포함). */
export function applyLineRangeEdit(content: string, args: LineRangeArgs): EditOutcome {
  const lines = content.split('\n')
  if (args.startLine < 1 || args.endLine > lines.length || args.startLine > args.endLine) {
    return {
      kind: 'error',
      error: `라인 번호 범위 오류: 파일은 ${lines.length}줄입니다. (startLine=${args.startLine}, endLine=${args.endLine})`,
    }
  }
  const newContent = [
    ...lines.slice(0, args.startLine - 1),
    args.new_string,
    ...lines.slice(args.endLine),
  ].join('\n')
  return { kind: 'ok', newContent, replacements: 1 }
}

/** old_string 매칭 기반 교체. 매칭 실패 시 정규화 폴백을 시도하고, 그래도 실패면 nearestMatch 힌트를 포함한 에러를 반환한다. */
export function applyOldStringEdit(content: string, args: OldStringArgs): EditOutcome {
  const occurrences = countOccurrences(content, args.old_string)

  if (occurrences === 0) {
    const fallback = tryNormalizedMatch(content, args.old_string, args.new_string, args.replace_all)
    if (fallback.result) {
      return {
        kind: 'ok',
        newContent: fallback.result.newContent,
        replacements: 1,
        fallbackStrategy: fallback.result.strategy,
      }
    }
    const nearestMatch = findNearestLines(content, args.old_string) ?? undefined
    return {
      kind: 'error',
      error: 'old_string을 파일에서 찾을 수 없습니다. 공백/들여쓰기를 포함하여 정확히 입력하세요.',
      hint: 'read_file로 파일을 다시 읽고 정확한 코드 블록을 확인하세요. 또는 startLine/endLine 방식을 사용하세요.',
      nearestMatch,
    }
  }

  if (occurrences > 1 && !args.replace_all) {
    return {
      kind: 'error',
      error: `old_string이 ${occurrences}개 매칭됩니다. replace_all: true로 모두 교체하거나 더 많은 주변 코드를 포함하세요.`,
      occurrences,
    }
  }

  let newContent: string
  if (args.replace_all) {
    newContent = content.split(args.old_string).join(args.new_string)
  } else {
    const idx = content.indexOf(args.old_string)
    newContent = content.slice(0, idx) + args.new_string + content.slice(idx + args.old_string.length)
  }
  return { kind: 'ok', newContent, replacements: args.replace_all ? occurrences : 1 }
}

/** 정규화 폴백 매칭: CRLF → LF → trailing whitespace 제거 순서로 시도. */
export function tryNormalizedMatch(
  content: string,
  oldStr: string,
  newStr: string,
  replaceAll: boolean,
): { result: { newContent: string; strategy: string } | null; diagnostics: string[] } {
  const strategies: Array<{ name: string; normalize: (s: string) => string }> = [
    { name: 'crlf', normalize: (s) => s.replace(/\r\n/g, '\n') },
    { name: 'trailing-whitespace', normalize: (s) => s.replace(/\r\n/g, '\n').split('\n').map((l) => l.trimEnd()).join('\n') },
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

/** old_string 첫 줄과 가장 유사한 파일 구간을 반환 (LLM 재시도 힌트용). 매칭 없으면 null. */
export function findNearestLines(content: string, oldStr: string): string | null {
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
