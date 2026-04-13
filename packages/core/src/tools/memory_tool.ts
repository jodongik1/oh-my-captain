import { z } from 'zod'
import { registerTool } from './registry.js'
import { loadMemory, saveMemory, searchMemory } from '../agent/memory.js'
import type { HostAdapter } from '../host/interface.js'

// ── save_memory ──────────────────────────────────────────────

const saveSchema = z.object({
  content: z.string().describe('저장할 메모리 내용 (아키텍처 결정, 코드 스타일, 알려진 이슈 등)'),
  category: z.enum(['architecture', 'style', 'issue', 'convention', 'general'])
    .optional()
    .default('general')
    .describe('메모리 분류'),
})

registerTool(
  {
    type: 'function',
    function: {
      name: 'save_memory',
      description: `세션 간 유지되는 영구 메모리에 중요한 정보를 저장합니다.
다음과 같은 경우 사용하세요:
- 프로젝트 아키텍처 결정을 발견/결정했을 때
- 코딩 컨벤션이나 스타일 패턴을 파악했을 때
- 알려진 이슈나 주의사항을 발견했을 때
- 사용자의 선호도를 파악했을 때
저장된 메모리는 다음 세션에서 시스템 프롬프트에 자동 포함됩니다.`,
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: '저장할 내용' },
          category: {
            type: 'string',
            enum: ['architecture', 'style', 'issue', 'convention', 'general'],
            description: '메모리 분류 (기본: general)',
          },
        },
        required: ['content'],
      },
    },
    category: 'write',
    concurrencySafe: true,
  },
  async (rawArgs, host: HostAdapter) => {
    const args = saveSchema.parse(rawArgs)
    const result = await saveMemory(host.getProjectRoot(), args.content, args.category)
    return {
      ...result,
      category: args.category,
      message: `메모리가 저장되었습니다. (총 ${result.totalEntries}개 항목)`,
    }
  }
)

// ── read_memory ──────────────────────────────────────────────

const readSchema = z.object({
  query: z.string().optional().describe('검색 키워드 (없으면 전체 메모리 반환)'),
})

registerTool(
  {
    type: 'function',
    function: {
      name: 'read_memory',
      description: `영구 메모리에 저장된 프로젝트 정보를 읽습니다.
키워드를 지정하면 관련 항목만 필터링합니다.
키워드 없이 호출하면 전체 메모리를 반환합니다.`,
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '검색 키워드 (선택)' },
        },
        required: [],
      },
    },
    category: 'readonly',
    concurrencySafe: true,
  },
  async (rawArgs, host: HostAdapter) => {
    const args = readSchema.parse(rawArgs)
    const memory = await loadMemory(host.getProjectRoot())

    if (!memory) {
      return { content: '', message: '저장된 메모리가 없습니다.' }
    }

    if (args.query) {
      const matches = searchMemory(memory, args.query)
      return {
        query: args.query,
        matchCount: matches.length,
        content: matches.join('\n---\n'),
      }
    }

    return { content: memory }
  }
)
