/**
 * @-멘션 자동완성을 위한 파일 검색 핸들러.
 *
 * 다층 필터링:
 *   1. .gitignore + .captain/ignore 자동 존중 (globby 의 ignoreFiles)
 *   2. 빌드/메타 디렉토리 블랙리스트 (node_modules, dist, target, .gradle 등)
 *   3. 바이너리 확장자 블랙리스트 (.class, .jar, .png, .pdf 등)
 *   4. 1MB 초과 파일 제외
 *   5. 매칭 점수(basename 우선) + 최근 수정시간으로 정렬
 */

import { registerHandler, send } from '../server.js'
import { makeLogger } from '../../utils/logger.js'
import type { CoreState } from './state.js'
import { globby } from 'globby'
import { stat } from 'fs/promises'
import { basename, join } from 'path'

const log = makeLogger('file_search.ts')

// ── 추가 디렉토리 블랙리스트 (gitignore 외에 무조건 제외) ──
const IGNORE_DIRS = [
  'node_modules', '.git', '.hg', '.svn',
  'build', 'dist', 'out', 'target',
  '.next', '.nuxt', '.svelte-kit', '.turbo', '.cache', '.parcel-cache',
  '.gradle', '.mvn',
  '.idea', '.vscode', '.fleet',
  'vendor', '.venv', 'venv', '.env',
  '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.tox',
  'coverage', '.nyc_output',
  'bin', 'obj',                      // .NET
]

// ── 바이너리 / 비-텍스트 확장자 ──
const BINARY_EXTENSIONS = [
  // JVM / 네이티브 산출물
  'class', 'jar', 'war', 'ear', 'aar',
  'o', 'a', 'so', 'dylib', 'dll', 'exe', 'pdb', 'lib', 'obj',
  // Python 캐시
  'pyc', 'pyo', 'pyd',
  // 이미지
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'webp', 'tif', 'tiff', 'heic', 'avif', 'psd',
  // 오디오 / 비디오
  'mp3', 'mp4', 'mov', 'avi', 'mkv', 'wav', 'flac', 'ogg', 'webm', 'm4a', 'm4v', 'wmv',
  // 압축
  'zip', 'tar', 'gz', 'bz2', 'xz', '7z', 'rar', 'tgz', 'tbz', 'txz',
  // 바이너리 문서
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp',
  // 폰트
  'ttf', 'otf', 'woff', 'woff2', 'eot',
  // 데이터베이스 / 직렬화
  'db', 'sqlite', 'sqlite3', 'mdb',
  // 번들 산출물 / 맵
  'min.js', 'min.css', 'map',
]

const IGNORE_FILES = ['.DS_Store', 'Thumbs.db']

const MAX_FILE_BYTES = 1024 * 1024     // 1MB — 멘션 후 read_file 시 토큰 한계 고려
const STAT_CANDIDATE_LIMIT = 120        // size/mtime 검사 대상 최대치 (성능)
const RESULT_LIMIT = 20                 // UI 에 반환할 결과 수

const IGNORE_GLOBS = [
  ...IGNORE_DIRS.map(d => `!**/${d}/**`),
  `!**/*.{${BINARY_EXTENSIONS.join(',')}}`,
  ...IGNORE_FILES.map(f => `!**/${f}`),
]

export function registerFileSearchHandlers(state: CoreState) {
  registerHandler('file_search', async (msg) => {
    try {
      const { query } = msg.payload

      if (!state.host) {
        throw new Error('Core is not initialized')
      }

      const root = state.host.getProjectRoot()

      // .gitignore 와 .captain/ignore 를 globby 가 직접 해석.
      // 각 파일이 없어도 globby 는 안전하게 무시함.
      const files = await globby(['**/*', ...IGNORE_GLOBS], {
        cwd: root,
        onlyFiles: true,
        absolute: false,
        gitignore: true,
        ignoreFiles: ['.gitignore', '.captain/ignore'],
        followSymbolicLinks: false,
        suppressErrors: true,
      })

      const top = await scoreAndRank(files, query, root)
      send({ id: msg.id, type: 'file_search_result', payload: { files: top } })
    } catch (e) {
      log.error('file_search failed:', e)
      send({ id: msg.id, type: 'file_search_result', payload: { files: [] } })
    }
  })
}

/**
 * 매칭 점수 + 파일 크기 + 최근 수정 시간을 종합해 상위 RESULT_LIMIT 개를 선별.
 */
async function scoreAndRank(files: string[], rawQuery: string, root: string): Promise<string[]> {
  const q = (rawQuery || '').toLowerCase().trim()

  // 1) query 매칭 1차 필터 (q 가 비어있으면 그대로 통과)
  const matched = q ? files.filter(p => p.toLowerCase().includes(q)) : files
  if (matched.length === 0) return []

  // 2) 매칭 점수 계산 → 상위 N 개만 stat 검사 (성능)
  const preScored = matched.map(p => ({ path: p, score: scorePath(p, q) }))
  preScored.sort((a, b) => b.score - a.score)
  const candidates = preScored.slice(0, STAT_CANDIDATE_LIMIT)

  // 3) size + mtime 병렬 검사
  const settled = await Promise.allSettled(
    candidates.map(async (c) => {
      const s = await stat(join(root, c.path))
      return { ...c, size: s.size, mtimeMs: s.mtimeMs }
    })
  )

  const validated: { path: string; score: number; mtimeMs: number }[] = []
  for (const r of settled) {
    if (r.status !== 'fulfilled') continue
    if (r.value.size > MAX_FILE_BYTES) continue
    validated.push({ path: r.value.path, score: r.value.score, mtimeMs: r.value.mtimeMs })
  }

  // 4) 최종 정렬:
  //    - query 있으면 점수 우선, 동점이면 최근 수정 시간
  //    - query 없으면 최근 수정 시간 우선
  if (q) {
    validated.sort((a, b) => b.score - a.score || b.mtimeMs - a.mtimeMs)
  } else {
    validated.sort((a, b) => b.mtimeMs - a.mtimeMs)
  }

  return validated.slice(0, RESULT_LIMIT).map(v => v.path)
}

/**
 * basename 우선 + 경로 깊이 페널티 + fuzzy 보조 매칭.
 * 점수 비교에만 쓰이므로 절대값 의미 없음.
 */
function scorePath(path: string, query: string): number {
  if (!query) return 0
  const lowerPath = path.toLowerCase()
  const base = basename(path).toLowerCase()
  let score = 0

  if (base === query) score += 1000
  else if (base.startsWith(query)) score += 500
  else if (base.includes(query)) score += 200

  if (lowerPath.includes(query) && score === 0) {
    // basename 매칭은 없지만 경로 어딘가에 포함 (디렉토리 매칭 등)
    score += 80
  } else if (lowerPath.includes(query)) {
    score += 30  // basename 매칭 + path 매칭 보너스
  }

  // 약한 fuzzy 보조 (basename/path 매칭 모두 실패한 경우)
  if (score === 0) {
    let qi = 0
    for (let i = 0; i < base.length && qi < query.length; i++) {
      if (base[i] === query[qi]) qi++
    }
    if (qi === query.length) score += 20
  }

  // 경로 깊이 페널티 (얕은 경로 우선)
  const depth = path.split(/[\\/]/).length
  score -= depth * 2

  return score
}
