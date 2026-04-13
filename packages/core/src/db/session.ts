import Database from 'better-sqlite3'
import { join } from 'path'
import { mkdirSync } from 'fs'
import { homedir } from 'os'
import { nanoid } from 'nanoid'

const DB_DIR = join(homedir(), '.omc')
const DB_PATH = join(DB_DIR, 'sessions.db')

let db: Database.Database | null = null

function getDb(): Database.Database {
  if (db) return db
  mkdirSync(DB_DIR, { recursive: true })
  db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  db.exec(`
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
  return db
}

export interface SessionSummary {
  id: string
  title: string
  updatedAt: number
  messageCount: number
  preview: string
}

export interface SessionMessage {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  timestamp: number
}

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
      (SELECT m.content FROM messages m WHERE m.session_id = s.id ORDER BY m.timestamp DESC LIMIT 1) as preview
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
  return getDb().prepare(
    'SELECT id, role, content, timestamp FROM messages WHERE session_id = ? ORDER BY timestamp ASC'
  ).all(sessionId) as SessionMessage[]
}

export function addMessage(sessionId: string, role: string, content: string): string {
  const id = nanoid()
  const now = Date.now()
  const d = getDb()
  d.prepare(
    'INSERT INTO messages (id, session_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)'
  ).run(id, sessionId, role, content, now)
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
