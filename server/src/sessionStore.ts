import { existsSync, readdirSync, readFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { appPaths } from './appPaths.js';
import type { Message, StudentRunResult } from './engine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const dbPath = appPaths().dbPath;
const sessionsDir = path.join(repoRoot, 'sessions');
const migratedDir = path.join(repoRoot, 'sessions.migrated');

export type PersistedNote = {
  role: 'student' | 'tutor';
  text: string;
  mode?: string;
  unlocked?: string[];
  redrafted?: boolean;
};

export type PersistedTake = {
  seq: number;
  ts: string;
  lang: string;
  code: string;
  results: StudentRunResult | null;
};

export type PersistedSession = {
  id: string;
  cardName: string;
  title: string;
  startedAt: string;
  updatedAt: string;
  solved: boolean;
  lang: string;
  code: string;
  notes: PersistedNote[];
  takes: PersistedTake[];
  lastRun: StudentRunResult | null;
  engine: { transcript: Message[]; lockedTerms: string[]; turnCounter: number };
};

type SessionRow = {
  id: string;
  card_name: string;
  title: string;
  started_at: string;
  updated_at: string;
  solved: number;
  lang: string;
  code: string;
  last_run: string | null;
  engine_transcript: string;
  engine_locked_terms: string;
  engine_turn_counter: number;
};

type NoteRow = {
  session_id: string;
  seq: number;
  role: string;
  text: string;
  mode: string | null;
  unlocked: string | null;
  redrafted: number | null;
};

type TakeRow = {
  session_id: string;
  seq: number;
  ts: string;
  lang: string;
  code: string;
  results: string | null;
};

let db: DatabaseSync | null = null;

function rowToSession(
  row: SessionRow,
  notes: PersistedNote[],
  takes: PersistedTake[],
): PersistedSession {
  return {
    id: row.id,
    cardName: row.card_name,
    title: row.title,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    solved: row.solved !== 0,
    lang: row.lang,
    code: row.code,
    notes,
    takes,
    lastRun: row.last_run ? (JSON.parse(row.last_run) as StudentRunResult) : null,
    engine: {
      transcript: JSON.parse(row.engine_transcript) as Message[],
      lockedTerms: JSON.parse(row.engine_locked_terms) as string[],
      turnCounter: row.engine_turn_counter,
    },
  };
}

function noteFromRow(row: NoteRow): PersistedNote {
  const note: PersistedNote = {
    role: row.role as PersistedNote['role'],
    text: row.text,
  };
  if (row.mode != null) note.mode = row.mode;
  if (row.unlocked != null) note.unlocked = JSON.parse(row.unlocked) as string[];
  if (row.redrafted != null) note.redrafted = row.redrafted !== 0;
  return note;
}

function loadNotes(database: DatabaseSync, sessionId: string): PersistedNote[] {
  const rows = database
    .prepare('SELECT * FROM notes WHERE session_id = ? ORDER BY seq ASC')
    .all(sessionId) as NoteRow[];
  return rows.map(noteFromRow);
}

function takeFromRow(row: TakeRow): PersistedTake {
  return {
    seq: row.seq,
    ts: row.ts,
    lang: row.lang,
    code: row.code,
    results: row.results ? (JSON.parse(row.results) as StudentRunResult) : null,
  };
}

function loadTakes(database: DatabaseSync, sessionId: string): PersistedTake[] {
  const rows = database
    .prepare('SELECT * FROM takes WHERE session_id = ? ORDER BY seq ASC')
    .all(sessionId) as TakeRow[];
  return rows.map(takeFromRow);
}

function migrateFromJsonFiles(database: DatabaseSync): void {
  if (!existsSync(sessionsDir)) return;
  let entries: string[];
  try {
    entries = readdirSync(sessionsDir).filter(
      (e) => e.endsWith('.json') && !e.endsWith('.json.tmp'),
    );
  } catch {
    return;
  }
  if (entries.length === 0) return;

  const existing = database.prepare('SELECT 1 FROM sessions WHERE id = ?');
  const insertSession = database.prepare(`
    INSERT INTO sessions (
      id, card_name, title, started_at, updated_at, solved, lang, code,
      last_run, engine_transcript, engine_locked_terms, engine_turn_counter
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertNote = database.prepare(`
    INSERT INTO notes (session_id, seq, role, text, mode, unlocked, redrafted)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  let migrated = 0;
  database.exec('BEGIN');
  try {
    for (const entry of entries) {
      let s: PersistedSession;
      try {
        s = JSON.parse(readFileSync(path.join(sessionsDir, entry), 'utf8')) as PersistedSession;
      } catch {
        continue;
      }
      if (!s?.id || existing.get(s.id)) continue;

      insertSession.run(
        s.id,
        s.cardName,
        s.title,
        s.startedAt,
        s.updatedAt,
        s.solved ? 1 : 0,
        s.lang ?? '',
        s.code ?? '',
        s.lastRun == null ? null : JSON.stringify(s.lastRun),
        JSON.stringify(s.engine?.transcript ?? []),
        JSON.stringify(s.engine?.lockedTerms ?? []),
        s.engine?.turnCounter ?? 0,
      );
      for (let i = 0; i < (s.notes?.length ?? 0); i++) {
        const n = s.notes[i]!;
        insertNote.run(
          s.id,
          i,
          n.role,
          n.text,
          n.mode ?? null,
          n.unlocked == null ? null : JSON.stringify(n.unlocked),
          n.redrafted == null ? null : n.redrafted ? 1 : 0,
        );
      }
      migrated++;
    }
    database.exec('COMMIT');
  } catch (err) {
    database.exec('ROLLBACK');
    throw err;
  }

  renameSync(sessionsDir, migratedDir);
  console.log(`migrated ${migrated} session(s) from sessions/ into tutor.db`);
}

function getDb(): DatabaseSync {
  if (db) return db;
  const database = new DatabaseSync(dbPath);
  database.exec('PRAGMA journal_mode = WAL');
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      card_name TEXT NOT NULL,
      title TEXT NOT NULL,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      solved INTEGER NOT NULL DEFAULT 0,
      lang TEXT NOT NULL DEFAULT '',
      code TEXT NOT NULL DEFAULT '',
      last_run TEXT,
      engine_transcript TEXT NOT NULL,
      engine_locked_terms TEXT NOT NULL,
      engine_turn_counter INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS notes (
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      mode TEXT,
      unlocked TEXT,
      redrafted INTEGER,
      PRIMARY KEY (session_id, seq)
    );
    CREATE TABLE IF NOT EXISTS takes (
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      ts TEXT NOT NULL,
      lang TEXT NOT NULL,
      code TEXT NOT NULL,
      results TEXT,
      PRIMARY KEY (session_id, seq)
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_card ON sessions(card_name);
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  migrateFromJsonFiles(database);
  db = database;
  return database;
}

export async function getSetting(key: string): Promise<string | null> {
  const database = getDb();
  const row = database.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const database = getDb();
  database
    .prepare(
      `
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `,
    )
    .run(key, value);
}

export async function saveSession(s: PersistedSession): Promise<void> {
  const database = getDb();
  database.exec('BEGIN');
  try {
    database
      .prepare(
        `
      INSERT INTO sessions (
        id, card_name, title, started_at, updated_at, solved, lang, code,
        last_run, engine_transcript, engine_locked_terms, engine_turn_counter
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        card_name = excluded.card_name,
        title = excluded.title,
        started_at = excluded.started_at,
        updated_at = excluded.updated_at,
        solved = excluded.solved,
        lang = excluded.lang,
        code = excluded.code,
        last_run = excluded.last_run,
        engine_transcript = excluded.engine_transcript,
        engine_locked_terms = excluded.engine_locked_terms,
        engine_turn_counter = excluded.engine_turn_counter
    `,
      )
      .run(
        s.id,
        s.cardName,
        s.title,
        s.startedAt,
        s.updatedAt,
        s.solved ? 1 : 0,
        s.lang,
        s.code,
        s.lastRun == null ? null : JSON.stringify(s.lastRun),
        JSON.stringify(s.engine.transcript),
        JSON.stringify(s.engine.lockedTerms),
        s.engine.turnCounter,
      );

    database.prepare('DELETE FROM notes WHERE session_id = ?').run(s.id);
    const insertNote = database.prepare(`
      INSERT INTO notes (session_id, seq, role, text, mode, unlocked, redrafted)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (let i = 0; i < s.notes.length; i++) {
      const n = s.notes[i]!;
      insertNote.run(
        s.id,
        i,
        n.role,
        n.text,
        n.mode ?? null,
        n.unlocked == null ? null : JSON.stringify(n.unlocked),
        n.redrafted == null ? null : n.redrafted ? 1 : 0,
      );
    }

    database.prepare('DELETE FROM takes WHERE session_id = ?').run(s.id);
    const insertTake = database.prepare(`
      INSERT INTO takes (session_id, seq, ts, lang, code, results)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const t of s.takes) {
      insertTake.run(
        s.id,
        t.seq,
        t.ts,
        t.lang,
        t.code,
        t.results == null ? null : JSON.stringify(t.results),
      );
    }
    database.exec('COMMIT');
  } catch (err) {
    database.exec('ROLLBACK');
    throw err;
  }
}

export async function loadSession(id: string): Promise<PersistedSession | null> {
  if (id.includes('/') || id.includes('\\') || id.includes('..')) return null;
  const database = getDb();
  const row = database.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as
    | SessionRow
    | undefined;
  if (!row) return null;
  return rowToSession(row, loadNotes(database, id), loadTakes(database, id));
}

export async function listSessions(): Promise<PersistedSession[]> {
  const database = getDb();
  const rows = database.prepare('SELECT * FROM sessions').all() as SessionRow[];
  return rows.map((row) =>
    rowToSession(row, loadNotes(database, row.id), loadTakes(database, row.id)),
  );
}

export function deleteSessions(ids: string[]): void {
  if (ids.length === 0) return;
  const database = getDb();
  database.exec('BEGIN');
  try {
    const del = database.prepare('DELETE FROM sessions WHERE id = ?');
    for (const id of ids) del.run(id);
    database.exec('COMMIT');
  } catch (err) {
    database.exec('ROLLBACK');
    throw err;
  }
}

/** Empty = never started: no turns, unsolved, blank code, no takes. */
export function isEmptySession(s: PersistedSession): boolean {
  return (
    s.engine.turnCounter === 0 && !s.solved && s.code === '' && s.takes.length === 0
  );
}
