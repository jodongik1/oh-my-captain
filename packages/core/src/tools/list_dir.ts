import { z } from 'zod'
import { readdir, stat } from 'fs/promises'
import { join, relative } from 'path'
import { registerTool } from './registry.js'
import { resolvePathOrRoot } from './_base.js'
import type { HostAdapter } from '../host/interface.js'

const argsSchema = z.object({
  path: z.string().describe('탐색할 디렉토리 경로'),
  depth: z.number().optional().default(1).describe('재귀 깊이 (기본: 1)'),
  showHidden: z.boolean().optional().default(false).describe('숨김 파일 표시 (기본: false)'),
})

interface DirEntry {
  name: string
  type: 'file' | 'directory'
  size?: number
  children?: DirEntry[]
}

registerTool(
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: `**좁은 범위(한 디렉토리, 1~2 단계)** 의 내용을 트리 형태로 보여줍니다.

⚠️ 트리 워킹 금지: 프로젝트 전체 구조 파악에 list_dir 을 반복 호출하지 마세요.
- 광범위 분석에는 \`glob_tool('**/*.{ts,tsx,kt,...}')\` 또는 \`run_terminal('find . -maxdepth 3 ...')\` 를 사용하세요.
- 한 번에 더 깊게 보려면 \`depth\` 를 2 이상으로 지정하세요 (기본 1).
- 같은 도구를 반복 호출하면 시스템이 hint 를 주입하고 강제 중단될 수 있습니다.

적절한 사용 예: 사용자가 "src/components 디렉토리만 보여줘" 처럼 좁은 범위를 명시했을 때.`,
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '디렉토리 경로' },
          depth: { type: 'number', description: '재귀 깊이 (기본: 1)' },
          showHidden: { type: 'boolean', description: '숨김 파일 표시 (기본: false)' },
        },
        required: ['path'],
      },
    },
    category: 'readonly',
    concurrencySafe: true,
  },
  async (rawArgs, host: HostAdapter) => {
    const args = argsSchema.parse(rawArgs)
    const absPath = resolvePathOrRoot(args.path, host)

    try {
      const entries = await listDirectory(absPath, args.depth, args.showHidden)
      return {
        path: relative(host.getProjectRoot(), absPath) || '.',
        entries,
        totalEntries: countEntries(entries),
      }
    } catch (e: any) {
      return { error: `디렉토리 탐색 실패: ${e.message}` }
    }
  }
)

async function listDirectory(dirPath: string, depth: number, showHidden: boolean): Promise<DirEntry[]> {
  const items = await readdir(dirPath, { withFileTypes: true })
  const entries: DirEntry[] = []

  // 무시할 디렉토리
  const ignored = new Set(['node_modules', '.git', '.idea', '__pycache__', 'dist', 'build', '.next'])

  for (const item of items) {
    if (!showHidden && item.name.startsWith('.')) continue
    if (ignored.has(item.name)) continue

    const fullPath = join(dirPath, item.name)

    if (item.isDirectory()) {
      const entry: DirEntry = { name: item.name, type: 'directory' }
      if (depth > 1) {
        try {
          entry.children = await listDirectory(fullPath, depth - 1, showHidden)
        } catch { /* permission denied 등 무시 */ }
      }
      entries.push(entry)
    } else if (item.isFile()) {
      try {
        const stats = await stat(fullPath)
        entries.push({ name: item.name, type: 'file', size: stats.size })
      } catch {
        entries.push({ name: item.name, type: 'file' })
      }
    }
  }

  // 디렉토리 먼저, 그 다음 파일 (알파벳 순)
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  return entries
}

function countEntries(entries: DirEntry[]): number {
  let count = entries.length
  for (const e of entries) {
    if (e.children) count += countEntries(e.children)
  }
  return count
}
