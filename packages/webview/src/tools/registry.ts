// 도구 메타데이터 단일 사실 출처.
// IPC 핸들러(라벨/요약 생성)와 ToolRow(렌더 분기) 양쪽이 본 레지스트리만 참조한다.
// 새 도구를 추가할 때는 객체 한 항목 + (필요 시) 전용 Row 컴포넌트만 등록하면 된다.

/** 도구 결과 행을 어떤 컴포넌트로 그릴지 결정하는 변종 키. */
export type ToolVariant = 'standard' | 'compact' | 'listing' | 'bash'

/** 시각적 카테고리 — CSS 클래스 토큰 (`tool-${cssClass}`) 으로 사용된다. */
export type ToolCssClass =
  | 'read' | 'write' | 'edit' | 'bash' | 'agent' | 'search' | 'generic'

export interface ToolMeta {
  /** 도구 식별자 (백엔드와 동일) */
  id: string
  /** 사용자에게 보일 영문 라벨 (Timeline 헤더용) */
  displayName: string
  /** 글로벌 활동 표시줄용 한국어 라벨 */
  activityLabel: string
  /** 시각 카테고리 */
  cssClass: ToolCssClass
  /** Row 렌더 변종 — Timeline 이 본 키로 컴포넌트를 디스패치 */
  variant: ToolVariant
  /**
   * 인자에서 status / 표시줄에 노출할 핵심 키워드 추출.
   * 반환값이 빈 문자열이면 라벨만 표시한다.
   */
  summarize?: (args: unknown) => string
  /** 인자에서 "에디터에서 열기" 대상 경로 추출. 없으면 클릭 비활성. */
  extractPath?: (args: unknown) => string | null
}

const SUMMARY_MAX = 48

function basenameOf(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…'
}

function pickString(args: unknown, key: string): string | null {
  if (!args || typeof args !== 'object') return null
  const v = (args as Record<string, unknown>)[key]
  return typeof v === 'string' && v.length > 0 ? v : null
}

const summarizers = {
  command: (args: unknown) => {
    const v = pickString(args, 'command')
    return v ? truncate(v, SUMMARY_MAX) : ''
  },
  pathBasename: (args: unknown) => {
    const v = pickString(args, 'path')
    return v ? truncate(basenameOf(v), SUMMARY_MAX) : ''
  },
  pathRaw: (args: unknown) => {
    const v = pickString(args, 'path')
    return v ? truncate(v, SUMMARY_MAX) : ''
  },
  pattern: (args: unknown) => {
    const v = pickString(args, 'pattern')
    return v ? truncate(v, SUMMARY_MAX) : ''
  },
  patternQuoted: (args: unknown) => {
    const v = pickString(args, 'pattern')
    return v ? `"${truncate(v, SUMMARY_MAX - 2)}"` : ''
  },
  query: (args: unknown) => {
    const v = pickString(args, 'query')
    return v ? truncate(v, SUMMARY_MAX) : ''
  },
  url: (args: unknown) => {
    const v = pickString(args, 'url')
    return v ? truncate(v, SUMMARY_MAX) : ''
  },
  memoryKey: (args: unknown) => {
    const cat = pickString(args, 'category')
    if (cat) return cat
    const q = pickString(args, 'query')
    return q ? truncate(q, SUMMARY_MAX) : ''
  },
}

/** path / AbsolutePath / TargetFile / DirectoryPath 중 첫 번째 발견값을 추출. */
function pathLikeExtractor(args: unknown): string | null {
  if (!args || typeof args !== 'object') return null
  const a = args as Record<string, unknown>
  for (const key of ['path', 'AbsolutePath', 'TargetFile', 'DirectoryPath']) {
    const v = a[key]
    if (typeof v === 'string' && v.length > 0) return v
  }
  return null
}

export const TOOL_REGISTRY: Record<string, ToolMeta> = {
  read_file: {
    id: 'read_file',
    displayName: 'Read',
    activityLabel: '파일 읽는 중',
    cssClass: 'read',
    variant: 'compact',
    summarize: summarizers.pathBasename,
    extractPath: pathLikeExtractor,
  },
  write_file: {
    id: 'write_file',
    displayName: 'Write',
    activityLabel: '파일 쓰는 중',
    cssClass: 'write',
    variant: 'standard',
    summarize: summarizers.pathBasename,
    extractPath: pathLikeExtractor,
  },
  edit_file: {
    id: 'edit_file',
    displayName: 'Edit',
    activityLabel: '파일 편집 중',
    cssClass: 'edit',
    variant: 'standard',
    summarize: summarizers.pathBasename,
    extractPath: pathLikeExtractor,
  },
  edit_symbol: {
    id: 'edit_symbol',
    displayName: 'Edit Symbol',
    activityLabel: '심볼 편집 중',
    cssClass: 'edit',
    variant: 'standard',
    summarize: summarizers.pathBasename,
    extractPath: pathLikeExtractor,
  },
  run_terminal: {
    id: 'run_terminal',
    displayName: 'Bash',
    activityLabel: 'Bash 실행 중',
    cssClass: 'bash',
    variant: 'bash',
    summarize: summarizers.command,
  },
  list_dir: {
    id: 'list_dir',
    displayName: 'List',
    activityLabel: '디렉토리 탐색 중',
    cssClass: 'bash',
    variant: 'listing',
    summarize: summarizers.pathRaw,
    extractPath: pathLikeExtractor,
  },
  glob_tool: {
    id: 'glob_tool',
    displayName: 'Glob',
    activityLabel: '파일 검색 중',
    cssClass: 'search',
    variant: 'listing',
    summarize: summarizers.pattern,
  },
  grep_tool: {
    id: 'grep_tool',
    displayName: 'Grep',
    activityLabel: '코드 검색 중',
    cssClass: 'search',
    variant: 'standard',
    summarize: summarizers.patternQuoted,
  },
  search_symbol: {
    id: 'search_symbol',
    displayName: 'Search Symbol',
    activityLabel: '심볼 검색 중',
    cssClass: 'search',
    variant: 'standard',
    summarize: summarizers.query,
  },
  fetch_url: {
    id: 'fetch_url',
    displayName: 'Fetch',
    activityLabel: 'URL 가져오는 중',
    cssClass: 'read',
    variant: 'standard',
    summarize: summarizers.url,
  },
  save_memory: {
    id: 'save_memory',
    displayName: 'Save Memory',
    activityLabel: '메모리 저장 중',
    cssClass: 'agent',
    variant: 'standard',
    summarize: summarizers.memoryKey,
  },
  read_memory: {
    id: 'read_memory',
    displayName: 'Read Memory',
    activityLabel: '메모리 읽는 중',
    cssClass: 'agent',
    variant: 'standard',
    summarize: summarizers.memoryKey,
  },
  agent: {
    id: 'agent',
    displayName: 'Agent',
    activityLabel: '에이전트 실행 중',
    cssClass: 'agent',
    variant: 'standard',
  },
}

/** 미등록 도구를 위한 기본 메타. 백엔드가 새 도구를 먼저 추가해도 화면이 깨지지 않도록 fallback. */
export function getToolMeta(tool: string): ToolMeta {
  return TOOL_REGISTRY[tool] ?? {
    id: tool,
    displayName: tool,
    activityLabel: `${tool} 실행 중`,
    cssClass: 'generic',
    variant: 'standard',
  }
}

/** 글로벌 활동 표시줄 라벨 — "파일 읽는 중: foo.ts" 형태. */
export function buildToolStatusLabel(tool: string, args: unknown): string {
  const meta = getToolMeta(tool)
  const summary = meta.summarize?.(args) ?? ''
  return summary ? `${meta.activityLabel}: ${summary}` : meta.activityLabel
}
