// esbuild로 단일 index.js 번들 생성
// native 모듈(better-sqlite3, sqlite-vec, web-tree-sitter)은 external 처리
import { build } from 'esbuild'
import { cpSync, mkdirSync } from 'fs'
import { resolve } from 'path'

const OUT_DIR = '../../hosts/intellij/src/main/resources/core'
mkdirSync(OUT_DIR, { recursive: true })

await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  outfile: `${OUT_DIR}/index.js`,
  external: [
    'better-sqlite3',
    'sqlite-vec',
    'web-tree-sitter',
    '*.node',
    'pino',
    'pino-pretty',
  ],
  format: 'cjs',
})

// 프롬프트 템플릿 복사 (esbuild는 .md 미포함)
// actions/prompts와 agent/prompts 모두 OUT_DIR/prompts 로 병합
cpSync('src/actions/prompts', `${OUT_DIR}/prompts`, { recursive: true })
cpSync('src/agent/prompts',   `${OUT_DIR}/prompts`, { recursive: true })

// native 모듈 + WASM 런타임을 위한 package.json 생성 후 설치 (transitive deps 해결)
import { writeFileSync, rmSync } from 'fs'
import { execSync } from 'child_process'

// 이전 빌드의 symlink 등 찌꺼기 제거
rmSync(resolve(OUT_DIR, 'node_modules'), { recursive: true, force: true })

const pkg = {
  name: 'omc-core-runtime',
  version: '1.0.0',
  private: true,
  dependencies: {
    'better-sqlite3': '^12.4.1',
    'sqlite-vec': '^0.1.9',
    'web-tree-sitter': '^0.22.6',
    'tree-sitter-wasms': '^0.1.11',
    'pino': '^10.3.1',
    'pino-pretty': '^13.1.3',
  }
}
writeFileSync(resolve(OUT_DIR, 'package.json'), JSON.stringify(pkg, null, 2))

console.log('Installing native dependencies in bundle...')
try {
  execSync('npm install --prefix . --omit=dev --no-package-lock', { 
    cwd: resolve(OUT_DIR), 
    stdio: 'inherit',
    env: { ...process.env, NPM_CONFIG_FUND: 'false', NPM_CONFIG_AUDIT: 'false' }
  })
} catch (e) {
  console.error('Failed to install native dependencies with npm. Please install npm or bundle manually.', e.message)
}

console.log('Core bundled to', OUT_DIR)
