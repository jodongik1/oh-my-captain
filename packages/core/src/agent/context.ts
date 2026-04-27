import { join } from 'path'
import { loadPrompt } from '../utils/prompt_loader.js'
import type { FileContext } from '../ipc/protocol.js'
import type { ToolDefinition } from '../tools/registry.js'

const BUNDLED_PROMPTS_DIR = join(__dirname, 'prompts')



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
- read_file, glob_tool, grep_tool, search_symbol, list_dir, fetch_url 을 자유롭게 사용해 코드베이스를 파악하세요.
- run_terminal 은 readonly 명령(ls, cat, find, head, tail, grep, rg, git status/log/diff/show, wc, tree 등)에만 사용하세요.
- 광범위 분석 요청이면 **첫 turn 에 glob_tool + run_terminal(find) + read_file(핵심 메타 3~5개) 을 병렬 호출**하세요.
- list_dir 로 트리를 한 단계씩 내려가는 것은 비효율입니다 — glob 패턴이나 find 한 번을 우선 시도.
- write_file, edit_file 또는 파괴적인 터미널 명령은 실행하지 마세요 — 거부됩니다.
- 수정할 파일, 라인 범위, 변경 내용을 구체적으로 명시한 구조화된 계획을 제시하세요.
- 사용자가 계획을 승인한 후에 편집을 진행하세요.`,

  ask: `당신은 **편집 전 확인 모드**입니다. 파일 읽기와 탐색은 자유롭게 할 수 있습니다.
- 광범위 분석 요청이면 **첫 turn 에 glob_tool + run_terminal(find) + read_file 을 병렬 호출**해 한 번에 그림을 잡으세요.
- list_dir 트리 워킹 대신 glob/find 를 우선 사용.
- 파일 쓰기나 상태를 변경하는 명령 실행 전에 사용자 승인이 요청됩니다.
- 각 쓰기 또는 터미널 작업 전에 한 줄로 짧게 의도를 설명하세요.`,

  auto: `당신은 **자동 편집 모드**입니다. 모든 도구가 사용자 승인 없이 즉시 실행됩니다.
- 읽기·쓰기·터미널 실행 모두 자유롭게 수행 가능. **파괴적 명령(rm, git push --force, git reset --hard 등)도 사용자 확인 없이 즉시 실행**됩니다.
- 사용자가 의도적으로 선택한 무승인 모드이므로, 되돌리기 어려운 명령은 신중하게 판단하세요. 의심되면 우선 git status / 백업 확인 후 진행하세요.
- 광범위 분석 요청이면 **첫 turn 에 glob_tool + run_terminal(find) + read_file 을 병렬 호출**해 한 번에 그림을 잡으세요.
- list_dir 트리 워킹 대신 glob/find 를 우선 사용.
- 불필요한 확인 없이 효율적으로 작업하세요.
- 작업 내용을 한 줄로 짧게 알리며 진행하세요. 장황한 안내 금지.`,
}

export async function buildSystemPrompt(input: SystemPromptInput): Promise<string> {
  const { projectRoot, openFiles, rules, memory, os, shell, tools, mode } = input

  const template = await loadPrompt('system_prompt.md', projectRoot, BUNDLED_PROMPTS_DIR)

  const toolDescriptions = tools.map(t => {
    const cat = t.category ? ` [${t.category}]` : ''
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
