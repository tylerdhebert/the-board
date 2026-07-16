import type { Message, StudentRunResult } from '../engine.js';

export type PersistedNote = {
  role: 'student' | 'tutor';
  text: string;
  mode?: string;
  unlocked?: string[];
  redrafted?: boolean;
  artifact?: { title: string; file: string };
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

export type SessionRow = {
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

export type NoteRow = {
  session_id: string;
  seq: number;
  role: string;
  text: string;
  mode: string | null;
  unlocked: string | null;
  redrafted: number | null;
  artifact: string | null;
};

export type TakeRow = {
  session_id: string;
  seq: number;
  ts: string;
  lang: string;
  code: string;
  results: string | null;
};
