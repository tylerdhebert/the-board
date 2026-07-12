import { existsSync, readdirSync, readFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { appPaths } from '../appPaths.js';
import type { PersistedSession } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const dbPath = appPaths().dbPath;
const sessionsDir = path.join(repoRoot, 'sessions');
const migratedDir = path.join(repoRoot, 'sessions.migrated');

let db: DatabaseSync | null = null;

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

export function getDb(): DatabaseSync {
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
