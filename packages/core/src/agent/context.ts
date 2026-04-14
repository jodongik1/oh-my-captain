import { readFile } from 'fs/promises'
import { join } from 'path'
import type { FileContext } from '../ipc/protocol.js'
import type { ToolDefinition } from '../tools/registry.js'

const BUNDLED_PROMPTS_DIR = join(__dirname, 'prompts')

/**
 * 프롬프트 파일 로드 우선순위:
 * 1. .captain/prompts/{file} — 사용자 커스터마이징
 * 2. 번들 내장 기본값
 */
async function loadPrompt(fileName: string, projectRoot: string): Promise<string> {
  const customPath = join(projectRoot, '.captain', 'prompts', fileName)
  try {
    return await readFile(customPath, 'utf-8')
  } catch {
    return await readFile(join(BUNDLED_PROMPTS_DIR, fileName), 'utf-8')
  }
}

interface SystemPromptInput {
  projectRoot: string
  openFiles: FileContext[]
  rules: string
  memory: string
  os: string
  shell: string
  tools: ToolDefinition[]
  mode: 'plan' | 'ask' | 'auto'
}

const MODE_LABEL: Record<string, string> = {
  plan: '플랜',
  ask:  '편집 전 확인',
  auto: '자동',
}

const MODE_INSTRUCTIONS: Record<string, string> = {
  plan: `당신은 **플랜 모드**입니다. 변경 전에 반드시 분석하고 상세한 계획을 먼저 제시해야 합니다.
- read_file, glob, grep, list_dir, search_symbol을 자유롭게 사용해 코드베이스를 파악하세요.
- run_terminal은 읽기 전용 명령(ls, cat, grep, find, git status/log/diff 등)에만 사용하세요.
- write_file, edit_file 또는 파괴적인 터미널 명령은 실행하지 마세요 — 거부됩니다.
- 수정할 파일, 라인 범위, 변경 내용을 구체적으로 명시한 구조화된 계획을 제시하세요.
- 사용자가 계획을 승인한 후에 편집을 진행하세요.`,

  ask: `당신은 **편집 전 확인 모드**입니다. 파일 읽기와 탐색은 자유롭게 할 수 있습니다.
- 파일 쓰기나 상태를 변경하는 명령 실행 전에 사용자 승인이 요청됩니다.
- 각 쓰기 또는 터미널 작업 전에 무엇을 할지 간략히 설명하세요.`,

  auto: `당신은 **자동 모드**입니다. 읽기, 쓰기, 실행을 자유롭게 수행할 수 있습니다.
- 불필요한 확인 없이 효율적으로 작업하세요.
- 작업 내용을 간략히 설명하며 진행하세요.`,
}

export async function buildSystemPrompt(input: SystemPromptInput): Promise<string> {
  const { projectRoot, openFiles, rules, memory, os, shell, tools, mode } = input

  const template = await loadPrompt('system_prompt.md', projectRoot)

  const toolDescriptions = tools.map(t => {
    const cat = ('category' in t) ? ` [${(t as any).category}]` : ''
    return `### ${t.function.name}${cat}\n${t.function.description}\nParameters: ${JSON.stringify(t.function.parameters, null, 2)}`
  }).join('\n\n')

  const openFileSummary = openFiles.length > 0
    ? openFiles.map(f => {
        const symbolList = f.symbols.map(s => `  - ${s.kind}: ${s.name} (line ${s.line})`).join('\n')
        return `#### ${f.path} (${f.language})\nSymbols:\n${symbolList}`
      }).join('\n\n')
    : '(없음)'

  const rulesSection = rules ? `## Project Rules\n\n${rules}` : ''
  const memorySection = memory
    ? `## Project Memory\n\nThe following is persistent knowledge saved from previous sessions:\n\n${memory}`
    : ''

  return template
    .replace('{{projectRoot}}', projectRoot)
    .replace('{{os}}', os)
    .replace('{{shell}}', shell)
    .replace('{{toolDescriptions}}', toolDescriptions)
    .replace('{{openFileSummary}}', openFileSummary)
    .replace('{{rulesSection}}', rulesSection)
    .replace('{{memorySection}}', memorySection)
    .replace('{{modeLabel}}', MODE_LABEL[mode] ?? mode)
    .replace('{{modeInstructions}}', MODE_INSTRUCTIONS[mode] ?? '')
}
