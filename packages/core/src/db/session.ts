import Database from 'better-sqlite3'
import { join } from 'path'
import { mkdirSync } from 'fs'
import { homedir } from 'os'
import { nanoid } from 'nanoid'
import { makeLogger } from '../utils/logger.js'
import type { SessionSummary, SessionMessage, SessionMessagePayload, ImageAttachment } from '@omc/protocol'

const log = makeLogger('session_db.ts')

const DB_DIR = join(homedir(), '.oh-my-captain')
const DB_PATH = join(DB_DIR, 'sessions.db')

let db: Database.Database | null = null

function bootstrapSchema(d: Database.Database): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'New Chat',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, timestamp);
  `)
  // payload 컬럼은 도구/thinking/첨부 등 풍부한 메시지 메타를 JSON 으로 저장.
  // 기존 DB 와의 호환을 위해 ALTER 로 추가하고, 이미 있으면 무시.
  ensurePayloadColumn(d)
}

/** 테스트에서 in-memory DB 주입을 위한 시앰. 스키마 부트스트랩까지 수행. 운영 코드에서는 호출하지 않는다. */
export function __setDbForTest(d: Database.Database | null): void {
  db = d
  if (d) bootstrapSchema(d)
}

function getDb(): Database.Database {
  if (db) return db
  mkdirSync(DB_DIR, { recursive: true })
  db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  log.info(`DB 초기화 완료: ${DB_PATH}`)
  bootstrapSchema(db)
  return db
}

function ensurePayloadColumn(d: Database.Database): void {
  const cols = d.prepare('PRAGMA table_info(messages)').all() as { name: string }[]
  if (!cols.some(c => c.name === 'payload')) {
    d.exec('ALTER TABLE messages ADD COLUMN payload TEXT')
    log.info('messages.payload 컬럼 추가')
  }
}

export type { SessionSummary, SessionMessage }

export function createSession(title?: string): string {
  const id = nanoid()
  const now = Date.now()
  getDb().prepare(
    'INSERT INTO sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)'
  ).run(id, title ?? 'New Chat', now, now)
  return id
}

export function listSessions(): SessionSummary[] {
  const rows = getDb().prepare(`
    SELECT s.id, s.title, s.updated_at,
      (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) as message_count,
      (SELECT m.content FROM messages m
        WHERE m.session_id = s.id AND m.role IN ('user','assistant') AND TRIM(m.content) <> ''
        ORDER BY m.timestamp DESC LIMIT 1) as preview
    FROM sessions s ORDER BY s.updated_at DESC
  `).all() as any[]

  return rows.map(r => ({
    id: r.id,
    title: r.title,
    updatedAt: r.updated_at,
    messageCount: r.message_count,
    preview: (r.preview ?? '').slice(0, 100)
  }))
}

export function getSessionMessages(sessionId: string): SessionMessage[] {
  const rows = getDb().prepare(
    'SELECT id, role, content, timestamp, payload FROM messages WHERE session_id = ? ORDER BY timestamp ASC'
  ).all(sessionId) as { id: string; role: string; content: string; timestamp: number; payload: string | null }[]

  return rows.map(r => {
    const base: SessionMessage = {
      id: r.id,
      role: r.role as SessionMessage['role'],
      content: r.content,
      timestamp: r.timestamp,
    }
    if (!r.payload) return base
    try {
      const parsed = JSON.parse(r.payload) as SessionMessagePayload
      return { ...base, ...parsed }
    } catch (e) {
      log.warn(`payload 파싱 실패 (msg=${r.id}): ${(e as Error).message}`)
      return base
    }
  })
}

/**
 * 새 메시지를 세션에 추가한다. payload 가 주어지면 JSON 으로 직렬화해 함께 저장.
 * payload 의 타입은 SessionMessagePayload — thinking, tool_calls, tool_call_id, attachments 등
 * 라이브 타임라인 복원에 필요한 메타를 담는다.
 */
export function addMessage(
  sessionId: string,
  role: string,
  content: string,
  payload?: SessionMessagePayload | null,
): string {
  const id = nanoid()
  const now = Date.now()
  const d = getDb()
  const payloadJson = payload && Object.keys(payload).length > 0 ? JSON.stringify(payload) : null
  d.prepare(
    'INSERT INTO messages (id, session_id, role, content, timestamp, payload) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, sessionId, role, content, now, payloadJson)
  d.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, sessionId)
  return id
}

export function renameSession(sessionId: string, title: string): void {
  getDb().prepare('UPDATE sessions SET title = ? WHERE id = ?').run(title, sessionId)
}

export function deleteSession(sessionId: string): void {
  const d = getDb()
  d.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId)
  d.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId)
}

/** 세션의 첫 사용자 메시지 기반으로 자동 제목 생성 */
export function autoTitle(sessionId: string): void {
  // 사용자가 수동으로 타이틀을 바꿨다면 덮어쓰지 않는다 — 기본값일 때만 적용.
  const row = getDb().prepare('SELECT title FROM sessions WHERE id = ?').get(sessionId) as { title: string } | undefined
  if (!row) return
  if (row.title !== 'New Chat' && row.title !== 'New Session') return

  const first = getDb().prepare(
    "SELECT content FROM messages WHERE session_id = ? AND role = 'user' ORDER BY timestamp ASC LIMIT 1"
  ).get(sessionId) as { content: string } | undefined
  if (first) {
    const title = first.content.slice(0, 50).replace(/\n/g, ' ').trim() || 'New Chat'
    renameSession(sessionId, title)
  }
}

export function closeDb(): void {
  db?.close()
  db = null
}

// re-export for callers that build payload values
export type { SessionMessagePayload, ImageAttachment }
