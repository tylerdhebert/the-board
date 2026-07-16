import type { DatabaseSync } from 'node:sqlite';
import type {
  NoteRow,
  PersistedNote,
  PersistedSession,
  PersistedTake,
  SessionRow,
  TakeRow,
} from './types.js';
import type { Message, StudentRunResult } from '../engine.js';

export function rowToSession(
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

export function noteFromRow(row: NoteRow): PersistedNote {
  const note: PersistedNote = {
    role: row.role as PersistedNote['role'],
    text: row.text,
  };
  if (row.mode != null) note.mode = row.mode;
  if (row.unlocked != null) note.unlocked = JSON.parse(row.unlocked) as string[];
  if (row.redrafted != null) note.redrafted = row.redrafted !== 0;
  if (row.artifact != null) note.artifact = JSON.parse(row.artifact) as { title: string; file: string };
  if (row.gesture != null) {
    note.gesture = JSON.parse(row.gesture) as NonNullable<PersistedNote['gesture']>;
  }
  if (row.blanks != null) note.blanks = JSON.parse(row.blanks) as string[];
  if (row.sent_back != null) note.sentBack = row.sent_back !== 0;
  return note;
}

export function loadNotes(database: DatabaseSync, sessionId: string): PersistedNote[] {
  const rows = database
    .prepare('SELECT * FROM notes WHERE session_id = ? ORDER BY seq ASC')
    .all(sessionId) as NoteRow[];
  return rows.map(noteFromRow);
}

export function takeFromRow(row: TakeRow): PersistedTake {
  return {
    seq: row.seq,
    ts: row.ts,
    lang: row.lang,
    code: row.code,
    results: row.results ? (JSON.parse(row.results) as StudentRunResult) : null,
  };
}

export function loadTakes(database: DatabaseSync, sessionId: string): PersistedTake[] {
  const rows = database
    .prepare('SELECT * FROM takes WHERE session_id = ? ORDER BY seq ASC')
    .all(sessionId) as TakeRow[];
  return rows.map(takeFromRow);
}
