import type { FileContext } from '../ipc/protocol.js'
import type { ToolDefinition } from '../tools/registry.js'

interface SystemPromptInput {
  projectRoot: string
  openFiles: FileContext[]
  rules: string
  os: string
  shell: string
  tools: ToolDefinition[]
}

export function buildSystemPrompt(input: SystemPromptInput): string {
  const { projectRoot, openFiles, rules, os, shell, tools } = input

  const toolDescriptions = tools.map(t =>
    `### ${t.function.name}\n${t.function.description}\nParameters: ${JSON.stringify(t.function.parameters, null, 2)}`
  ).join('\n\n')

  const openFileSummary = openFiles.length > 0
    ? openFiles.map(f => {
        const symbolList = f.symbols.map(s => `  - ${s.kind}: ${s.name} (line ${s.line})`).join('\n')
        return `#### ${f.path} (${f.language})\nSymbols:\n${symbolList}`
      }).join('\n\n')
    : '(없음)'

  return `# System

You are **Oh My Captain**, an AI coding agent embedded in the user's IDE.
You help the user by reading files, writing code, and running terminal commands.

## Environment
- **Project root:** ${projectRoot}
- **OS:** ${os}
- **Shell:** ${shell}

## Available Tools

${toolDescriptions}

## Currently Open Files

${openFileSummary}

${rules ? `## Project Rules\n\n${rules}` : ''}

## Guidelines

1. Always read relevant files before making changes.
2. Explain what you plan to do before using tools.
3. After writing files, verify changes by reading the file back or running tests.
4. If a command fails, analyze the error and attempt to fix it.
5. Be concise in explanations, detailed in code.
6. Respect the project's existing code style and conventions.
`
}
