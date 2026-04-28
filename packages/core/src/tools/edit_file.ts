import { z } from 'zod'
import { readFile, writeFile, stat } from 'fs/promises'
import { registerTool } from './registry.js'
import { generateUnifiedDiff } from '../utils/diff.js'
import { resolveSecurePath } from '../utils/path.js'
import { makeLogger } from '../utils/logger.js'
import { defaultFileReadCache } from './file_read_cache.js'
import { applyLineRangeEdit, applyOldStringEdit, type EditOutcome } from './edit_file_helpers.js'
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

type EditArgs = z.infer<typeof argsSchema>

/** args 형태로부터 어떤 편집 모드인지 판별하고 헬퍼 함수에 위임. */
function planEdit(currentContent: string, args: EditArgs): EditOutcome {
  if (args.startLine != null && args.endLine != null) {
    return applyLineRangeEdit(currentContent, {
      startLine: args.startLine,
      endLine: args.endLine,
      new_string: args.new_string,
    })
  }
  if (args.old_string != null) {
    return applyOldStringEdit(currentContent, {
      old_string: args.old_string,
      new_string: args.new_string,
      replace_all: args.replace_all ?? false,
    })
  }
  return {
    kind: 'error',
    error: 'startLine/endLine 또는 old_string 중 하나를 반드시 제공해야 합니다.',
  }
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
        const outcome = planEdit(currentContent, args)
        if (outcome.kind !== 'ok') return {}
        return { diff: generateUnifiedDiff(args.path, currentContent, outcome.newContent) }
      } catch {
        return {}
      }
    },
  },
  async (rawArgs, host: HostAdapter) => {
    const args = argsSchema.parse(rawArgs)
    const absPath = resolveSecurePath(args.path, host.getProjectRoot())
    const mode = args.startLine != null ? 'line-range' : 'old_string'
    log.info({ path: args.path, absPath, mode }, '[edit_file] 시작')

    let currentContent: string
    let currentMtimeMs = 0
    try {
      const [c, st] = await Promise.all([
        readFile(absPath, 'utf-8'),
        stat(absPath),
      ])
      currentContent = c
      currentMtimeMs = st.mtimeMs
    } catch (e) {
      log.error({ path: args.path, error: (e as Error).message }, '[edit_file] 파일 읽기 실패')
      return { error: `파일을 찾을 수 없습니다: ${args.path}` }
    }

    // Stale-write guard: read_file로 읽은 후 외부에서 변경되었는지 확인 (TTL 만료도 캐시 미스로 처리)
    const cached = defaultFileReadCache.get(absPath)
    if (!cached) {
      log.warn({ path: args.path }, '[edit_file] read_file 없이 직접 호출 또는 TTL 초과')
      return {
        error: 'edit_file 사용 전 반드시 read_file로 파일을 먼저 읽어야 합니다.',
        hint: 'read_file을 호출해 파일 내용을 먼저 읽고, 그 후 edit_file을 사용하세요.',
      }
    }
    if (cached.content !== currentContent) {
      log.warn({ path: args.path, cachedMtime: cached.mtimeMs, currentMtime: currentMtimeMs }, '[edit_file] 외부 파일 수정 감지')
      defaultFileReadCache.markRead(absPath, currentContent, currentMtimeMs)
      return {
        error: '파일이 마지막 read_file 이후 변경되었습니다. 다시 read_file로 읽어주세요.',
        stale: true,
      }
    }
    // mtime 만 다르고 content 동일 → touch 등 무해한 변경. 캐시 mtime 만 갱신하고 진행.
    if (cached.mtimeMs && cached.mtimeMs !== currentMtimeMs) {
      log.debug({ path: args.path, cachedMtime: cached.mtimeMs, currentMtime: currentMtimeMs }, '[edit_file] mtime 변경 but content 동일 — 진행')
      defaultFileReadCache.markRead(absPath, currentContent, currentMtimeMs)
    }

    const outcome = planEdit(currentContent, args)
    if (outcome.kind === 'error') {
      log.warn({ path: args.path, error: outcome.error }, '[edit_file] 편집 실패')
      const { kind: _kind, ...rest } = outcome
      return rest
    }

    await host.triggerSafetySnapshot(absPath)
    try {
      await writeFile(absPath, outcome.newContent, 'utf-8')
    } catch (e) {
      log.error({ path: args.path, error: (e as Error).message }, '[edit_file] 파일 쓰기 실패')
      throw e
    }
    // 우리가 방금 쓴 파일의 mtime 으로 캐시 갱신 — 다음 edit_file 의 stale 비교 기준이 된다.
    const newStat = await stat(absPath).catch(() => null)
    defaultFileReadCache.markRead(absPath, outcome.newContent, newStat?.mtimeMs ?? 0)

    const diff = generateUnifiedDiff(args.path, currentContent, outcome.newContent)
    const linesChanged = diff.split('\n').filter((l) => l.startsWith('+') || l.startsWith('-')).length
    log.info({ path: args.path, mode, linesChanged, replacements: outcome.replacements, fallbackStrategy: outcome.fallbackStrategy }, '[edit_file] 완료')

    return {
      path: args.path,
      replacements: outcome.replacements,
      diff,
      linesChanged,
      ...(outcome.fallbackStrategy ? { fallbackStrategy: outcome.fallbackStrategy } : {}),
    }
  },
)
