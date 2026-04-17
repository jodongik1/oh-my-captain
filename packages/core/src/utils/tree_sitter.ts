import Parser from 'web-tree-sitter'
import { createRequire } from 'module'
import { extname } from 'path'

// process.argv[1]: 개발(tsx) = 실행 스크립트, CJS 번들 = 번들 파일 경로
// import.meta 미사용 → CJS 번들에서 빈 객체 경고 없음
const require = createRequire(`file://${process.argv[1]}`)

let initialized = false

const LANG_MAP: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.py': 'python',
  '.java': 'java',
  '.go': 'go',
  '.kt': 'kotlin',
}

export function getSupportedExtensions(): string[] {
  return Object.keys(LANG_MAP)
}

export async function getParserForFile(filePath: string): Promise<Parser | null> {
  const ext = extname(filePath).toLowerCase()
  const langName = LANG_MAP[ext]
  if (!langName) return null

  if (!initialized) {
    await Parser.init()
    initialized = true
  }

  try {
    const wasmPath: string = require.resolve(`tree-sitter-wasms/out/tree-sitter-${langName}.wasm`)
    const lang = await Parser.Language.load(wasmPath)
    const parser = new Parser()
    parser.setLanguage(lang)
    return parser
  } catch {
    return null
  }
}
