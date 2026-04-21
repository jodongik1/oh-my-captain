import { z } from 'zod'
import { readFile, writeFile } from 'fs/promises'
import { join, isAbsolute } from 'path'
import { registerTool } from './registry.js'
import { generateUnifiedDiff } from '../utils/diff.js'
import { getParserForFile, getSupportedExtensions } from '../utils/tree_sitter.js'
import { markFileRead } from './edit_file.js'
import { makeLogger } from '../utils/logger.js'

const log = makeLogger('edit_symbol.ts')
import type { HostAdapter } from '../host/interface.js'
import type Parser from 'web-tree-sitter'

const argsSchema = z.object({
  path: z.string().describe('편집할 파일 경로'),
  symbolName: z.string().describe('편집할 심볼 이름 (함수명, 클래스명 등)'),
  symbolType: z.enum(['function', 'class', 'method', 'interface', 'any']).optional().default('any').describe('심볼 종류'),
  new_string: z.string().describe('심볼 전체를 교체할 새 코드'),
})

// 언어별 탐색 대상 노드 타입
const SYMBOL_NODE_TYPES: Record<string, string[]> = {
  function: [
    'function_declaration',
    'function_expression',
    'arrow_function',
    'function_definition',  // Python
    'method_declaration',   // Java/Kotlin
  ],
  class: [
    'class_declaration',
    'class_definition',     // Python
  ],
  method: [
    'method_definition',
    'method_declaration',
    'function_declaration',
  ],
  interface: [
    'interface_declaration',
  ],
  any: [
    'function_declaration', 'function_expression', 'arrow_function',
    'function_definition', 'method_declaration', 'method_definition',
    'class_declaration', 'class_definition',
    'interface_declaration',
  ],
}

registerTool(
  {
    type: 'function',
    function: {
      name: 'edit_symbol',
      description: `AST 분석을 통해 함수·클래스·메서드 이름으로 심볼을 찾아 전체 코드를 교체합니다.
- read_file로 파일을 먼저 읽을 필요 없이 심볼 이름만으로 정확히 찾습니다.
- 지원 언어: TypeScript, TSX, JavaScript, Python, Java, Go, Kotlin
- 함수 전체(시그니처 + 바디)를 new_string으로 교체합니다.
- 심볼을 찾지 못하면 edit_file의 라인 번호 방식이나 old_string 방식을 사용하세요.`,
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '파일 경로' },
          symbolName: { type: 'string', description: '함수명, 클래스명 등 심볼 이름' },
          symbolType: {
            type: 'string',
            enum: ['function', 'class', 'method', 'interface', 'any'],
            description: '심볼 종류 (기본: any)',
          },
          new_string: { type: 'string', description: '심볼 전체를 교체할 새 코드' },
        },
        required: ['path', 'symbolName', 'new_string'],
      },
    },
    category: 'write',
    concurrencySafe: false,
    preview: async (rawArgs, host) => {
      const args = argsSchema.parse(rawArgs)
      const absPath = isAbsolute(args.path) ? args.path : join(host.getProjectRoot(), args.path)
      try {
        const currentContent = await readFile(absPath, 'utf-8')
        const range = await findSymbolRange(absPath, currentContent, args.symbolName, args.symbolType)
        if (!range) return {}
        const newContent = currentContent.slice(0, range.startIndex) + args.new_string + currentContent.slice(range.endIndex)
        return { diff: generateUnifiedDiff(args.path, currentContent, newContent) }
      } catch {
        return {}
      }
    },
  },
  async (rawArgs, host: HostAdapter) => {
    const args = argsSchema.parse(rawArgs)
    const absPath = isAbsolute(args.path) ? args.path : join(host.getProjectRoot(), args.path)

    log.info({ path: args.path, symbolName: args.symbolName, symbolType: args.symbolType }, '[edit_symbol] 시작')

    let currentContent: string
    try {
      currentContent = await readFile(absPath, 'utf-8')
    } catch (e) {
      return { error: `파일을 찾을 수 없습니다: ${args.path}` }
    }

    const range = await findSymbolRange(absPath, currentContent, args.symbolName, args.symbolType)

    if (!range) {
      const supported = getSupportedExtensions().join(', ')
      log.warn({ path: args.path, symbolName: args.symbolName }, '[edit_symbol] 심볼을 찾을 수 없음')
      return {
        error: `심볼 '${args.symbolName}'을 찾을 수 없습니다.`,
        hint: `지원 언어: ${supported}. 심볼 이름과 파일 경로를 확인하세요. 찾지 못하면 edit_file의 startLine/endLine 방식을 사용하세요.`,
      }
    }

    log.info({ path: args.path, symbolName: args.symbolName, startIndex: range.startIndex, endIndex: range.endIndex }, '[edit_symbol] 심볼 발견')

    await host.triggerSafetySnapshot(absPath)
    const newContent = currentContent.slice(0, range.startIndex) + args.new_string + currentContent.slice(range.endIndex)

    try {
      await writeFile(absPath, newContent, 'utf-8')
    } catch (e) {
      log.error({ path: args.path, error: (e as Error).message }, '[edit_symbol] 파일 쓰기 실패')
      throw e
    }

    markFileRead(absPath, newContent)

    const diff = generateUnifiedDiff(args.path, currentContent, newContent)
    const linesChanged = diff.split('\n').filter(l => l.startsWith('+') || l.startsWith('-')).length
    log.info({ path: args.path, linesChanged }, '[edit_symbol] 완료')

    return { path: args.path, symbolName: args.symbolName, diff, linesChanged }
  }
)

interface SymbolRange {
  startIndex: number
  endIndex: number
}

async function findSymbolRange(
  filePath: string,
  content: string,
  symbolName: string,
  symbolType: string
): Promise<SymbolRange | null> {
  const parser = await getParserForFile(filePath)
  if (!parser) return null

  const tree = parser.parse(content)
  const targetNodeTypes = SYMBOL_NODE_TYPES[symbolType] ?? SYMBOL_NODE_TYPES['any']

  return walkTree(tree.rootNode, symbolName, targetNodeTypes)
}

function walkTree(
  node: Parser.SyntaxNode,
  symbolName: string,
  targetTypes: string[]
): SymbolRange | null {
  if (targetTypes.includes(node.type)) {
    const nameNode = findNameNode(node)
    if (nameNode?.text === symbolName) {
      return { startIndex: node.startIndex, endIndex: node.endIndex }
    }
  }

  for (const child of node.children) {
    const result = walkTree(child, symbolName, targetTypes)
    if (result) return result
  }

  return null
}

function findNameNode(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
  // 직접 자식 중 identifier 또는 property_identifier 탐색
  for (const child of node.children) {
    if (child.type === 'identifier' || child.type === 'property_identifier') {
      return child
    }
  }
  return null
}
