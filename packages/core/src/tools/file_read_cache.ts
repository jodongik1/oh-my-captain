/**
 * read_file → edit_file 사이의 stale-write guard 용 캐시.
 *
 * - read_file 이 파일을 읽을 때 markRead(path, content, mtimeMs) 로 등록
 * - edit_file 이 편집 직전 get() 으로 검증
 *   - 캐시 미스 → "read_file 먼저 호출" 안내
 *   - 캐시 히트지만 디스크 내용 ≠ 캐시 → 외부 수정 감지, 재읽기 안내
 *   - mtime 만 다르고 content 동일 → touch 로 간주, 캐시 갱신 후 진행
 * - TTL 만료 시 자동 폐기
 */
const DEFAULT_TTL_MS = 5 * 60 * 1000  // 5분

interface CacheEntry {
  content: string
  timestamp: number
  /** read 시점의 파일 mtime (ms). 외부 동시 편집 감지용. */
  mtimeMs: number
}

export class FileReadCache {
  private readonly entries = new Map<string, CacheEntry>()
  private readonly ttlMs: number

  constructor(ttlMs: number = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs
  }

  /**
   * 파일 read 결과를 캐시에 등록.
   * @param mtimeMs fs.stat().mtimeMs — 외부 변경 감지용. 알 수 없으면 0.
   */
  markRead(absPath: string, content: string, mtimeMs = 0): void {
    this.entries.set(absPath, { content, timestamp: Date.now(), mtimeMs })
  }

  /** TTL 내 항목만 반환. 만료되면 삭제 후 null. */
  get(absPath: string): { content: string; ageMs: number; mtimeMs: number } | null {
    const entry = this.entries.get(absPath)
    if (!entry) return null
    const ageMs = Date.now() - entry.timestamp
    if (ageMs > this.ttlMs) {
      this.entries.delete(absPath)
      return null
    }
    return { content: entry.content, ageMs, mtimeMs: entry.mtimeMs }
  }

  delete(absPath: string): void {
    this.entries.delete(absPath)
  }

  clear(): void {
    this.entries.clear()
  }

  get size(): number {
    return this.entries.size
  }

  get ttlMsValue(): number {
    return this.ttlMs
  }
}

/** 모듈 전역 단일 인스턴스. 도구들이 공유. 테스트는 새 FileReadCache 인스턴스 생성하여 사용. */
export const defaultFileReadCache = new FileReadCache()
