import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { databaseFile, type VocabConfig } from './config.js'
import type { Direction } from '../shared/protocol.js'

/** One chat thread: the word it started from, its direction and its transcript. */
export interface Session {
  id: string
  title: string
  direction: Direction
  term: string | null
  createdAt: number
  updatedAt: number
  turns: number
}

export interface Message {
  id: number
  sessionId: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
}

const SCHEMA = `
create table if not exists sessions (
  id text primary key,
  title text not null,
  direction text not null,
  term text,
  created_at integer not null,
  updated_at integer not null
);

create table if not exists messages (
  id integer primary key autoincrement,
  session_id text not null references sessions(id) on delete cascade,
  role text not null,
  content text not null,
  created_at integer not null
);

create index if not exists messages_by_session on messages(session_id, id);
`

let db: DatabaseSync | null = null
let dbPath = ''

export function openDatabase(config: VocabConfig): DatabaseSync {
  if (db) return db
  dbPath = databaseFile(config)
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  db = new DatabaseSync(dbPath)
  db.exec('pragma journal_mode = wal')
  db.exec('pragma foreign_keys = on')
  db.exec(SCHEMA)
  return db
}

export function pathOfDatabase(): string {
  return dbPath
}

function database(): DatabaseSync {
  if (!db) throw new Error('The database has not been opened yet.')
  return db
}

export function createSession(input: {
  id: string
  title: string
  direction: Direction
  term: string | null
}): Session {
  const now = Date.now()
  database()
    .prepare(
      `insert into sessions (id, title, direction, term, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?)`,
    )
    .run(input.id, input.title, input.direction, input.term, now, now)
  return getSession(input.id)!.session
}

export function addMessage(
  sessionId: string,
  role: 'user' | 'assistant',
  content: string,
): Message {
  const now = Date.now()
  const result = database()
    .prepare(
      'insert into messages (session_id, role, content, created_at) values (?, ?, ?, ?)',
    )
    .run(sessionId, role, content, now)
  database()
    .prepare('update sessions set updated_at = ? where id = ?')
    .run(now, sessionId)
  return {
    id: Number(result.lastInsertRowid),
    sessionId,
    role,
    content,
    createdAt: now,
  }
}

interface SessionRecord {
  id: string
  title: string
  direction: Direction
  term: string | null
  created_at: number
  updated_at: number
  turns: number
}

function toSession(row: SessionRecord): Session {
  return {
    id: row.id,
    title: row.title,
    direction: row.direction as Direction,
    term: row.term,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    turns: row.turns,
  }
}

const SESSION_SELECT = `
  select s.*, (select count(*) from messages m where m.session_id = s.id) as turns
  from sessions s`

export function listSessions(query = '', limit = 100): Session[] {
  const db = database()
  const trimmed = query.trim()
  if (trimmed) {
    const like = `%${trimmed}%`
    const rows = db
      .prepare(
        `${SESSION_SELECT}
         where s.title like ? or s.term like ?
            or exists (select 1 from messages m where m.session_id = s.id and m.content like ?)
         order by s.updated_at desc limit ?`,
      )
      .all(like, like, like, limit) as unknown as SessionRecord[]
    return rows.map(toSession)
  }
  const rows = db
    .prepare(`${SESSION_SELECT} order by s.updated_at desc limit ?`)
    .all(limit) as unknown as SessionRecord[]
  return rows.map(toSession)
}

export function getSession(
  id: string,
): { session: Session; messages: Message[] } | undefined {
  const db = database()
  const row = db.prepare(`${SESSION_SELECT} where s.id = ?`).get(id) as
    | SessionRecord
    | undefined
  if (!row) return undefined
  const messages = db
    .prepare('select * from messages where session_id = ? order by id asc')
    .all(id) as unknown as {
    id: number
    session_id: string
    role: 'user' | 'assistant'
    content: string
    created_at: number
  }[]
  return {
    session: toSession(row),
    messages: messages.map((m) => ({
      id: m.id,
      sessionId: m.session_id,
      role: m.role,
      content: m.content,
      createdAt: m.created_at,
    })),
  }
}

export function deleteSession(id: string): boolean {
  const result = database().prepare('delete from sessions where id = ?').run(id)
  return Number(result.changes) > 0
}

export function updateSession(
  id: string,
  patch: { title?: string; term?: string; direction?: Direction },
): void {
  const sets: string[] = []
  const values: (string | number)[] = []
  if (patch.title !== undefined) {
    sets.push('title = ?')
    values.push(patch.title)
  }
  if (patch.term !== undefined) {
    sets.push('term = ?')
    values.push(patch.term)
  }
  if (patch.direction !== undefined) {
    sets.push('direction = ?')
    values.push(patch.direction)
  }
  if (!sets.length) return
  sets.push('updated_at = ?')
  values.push(Date.now())
  values.push(id)
  database()
    .prepare(`update sessions set ${sets.join(', ')} where id = ?`)
    .run(...values)
}

export function stats(): { sessions: number; messages: number } {
  const db = database()
  const one = (sql: string) => Number((db.prepare(sql).get() as { n: number }).n)
  return {
    sessions: one('select count(*) as n from sessions'),
    messages: one('select count(*) as n from messages'),
  }
}
