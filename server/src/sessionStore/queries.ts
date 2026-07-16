import { getDb } from './db.js';
import { loadNotes, loadTakes, rowToSession } from './rowMapping.js';
import type { PersistedSession, SessionRow } from './types.js';

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

export async function deleteSetting(key: string): Promise<void> {
  getDb().prepare('DELETE FROM settings WHERE key = ?').run(key);
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
