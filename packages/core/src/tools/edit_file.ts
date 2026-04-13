import { z } from 'zod'
import { readFile, writeFile } from 'fs/promises'
import { join, isAbsolute } from 'path'
import { registerTool } from './registry.js'
import { generateUnifiedDiff } from '../utils/diff.js'
import type { HostAdapter } from '../host/interface.js'

const argsSchema = z.object({
  path: z.string().describe('편집할 파일 경로'),
  old_string: z.string().describe('교체 대상 기존 코드 블록 (정확 매칭)'),
  new_string: z.string().describe('교체할 새 코드 블록'),
  replace_all: z.boolean().optional().default(false).describe('true면 모든 매칭을 교체, false면 첫 번째만'),
})

// 최근 read된 파일을 추적하는 stale-write guard
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
  },
  async (rawArgs, host: HostAdapter) => {
    const args = argsSchema.parse(rawArgs)
    const absPath = isAbsolute(args.path)
      ? args.path
      : join(host.getProjectRoot(), args.path)

    // 현재 파일 내용 읽기
    let currentContent: string
    try {
      currentContent = await readFile(absPath, 'utf-8')
    } catch {
      return { error: `파일을 찾을 수 없습니다: ${args.path}` }
    }

    // Stale-write guard: read_file로 읽은 후 외부에서 변경되었는지 확인
    const cached = readCache.get(absPath)
    if (cached && cached.content !== currentContent) {
      // 디스크의 파일이 캐시와 다름 → 외부 수정 감지
      readCache.set(absPath, { content: currentContent, timestamp: Date.now() })
      return {
        error: '파일이 마지막 read_file 이후 변경되었습니다. 다시 read_file로 읽어주세요.',
        stale: true,
      }
    }

    // old_string 매칭 검증
    const occurrences = countOccurrences(currentContent, args.old_string)
    if (occurrences === 0) {
      return {
        error: 'old_string을 파일에서 찾을 수 없습니다. 공백/들여쓰기를 포함하여 정확히 입력하세요.',
        hint: '파일을 다시 read_file로 읽고 정확한 코드 블록을 확인하세요.',
      }
    }
    if (occurrences > 1 && !args.replace_all) {
      return {
        error: `old_string이 ${occurrences}개 매칭됩니다. replace_all: true로 모두 교체하거나 더 많은 주변 코드를 포함하세요.`,
        occurrences,
      }
    }

    // 변경 전 스냅샷
    await host.triggerSafetySnapshot(absPath)

    // 교체 실행
    let newContent: string
    if (args.replace_all) {
      newContent = currentContent.split(args.old_string).join(args.new_string)
    } else {
      const idx = currentContent.indexOf(args.old_string)
      newContent = currentContent.slice(0, idx) + args.new_string + currentContent.slice(idx + args.old_string.length)
    }

    await writeFile(absPath, newContent, 'utf-8')

    // 캐시 업데이트
    readCache.set(absPath, { content: newContent, timestamp: Date.now() })

    // diff 생성
    const diff = generateUnifiedDiff(args.path, currentContent, newContent)

    return {
      path: args.path,
      replacements: args.replace_all ? occurrences : 1,
      diff,
      linesChanged: diff.split('\n').filter(l => l.startsWith('+') || l.startsWith('-')).length,
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
