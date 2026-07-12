import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  JsonlTracer,
  TutorSession,
  extractCases,
  loadCard,
  type CaseSpec,
  type ProblemCard,
  type StudentRunResult,
} from '../engine.js';
import { appPaths } from '../appPaths.js';
import {
  loadSession,
  saveSession,
  type PersistedSession,
  type PersistedTake,
} from '../sessionStore.js';
import { loadSettings } from '../settings.js';

const paths = appPaths();

export type SessionEntry = {
  session: TutorSession;
  card: ProblemCard;
  cardName: string;
  cases?: CaseSpec[];
  persisted: PersistedSession;
};

export const sessions = new Map<string, SessionEntry>();

/** Per-session in-flight stress generation — concurrent clicks share one promise. */
export const stressInflight = new Map<
  string,
  Promise<{ count: number; stress: { input: string; output: string }[] }>
>();

export const RUNNABLE = new Set(['python', 'typescript', 'javascript', 'csharp']);

export const LANG_SLUG: Record<string, string> = {
  python: 'python3',
  typescript: 'typescript',
  javascript: 'javascript',
  csharp: 'csharp',
};

function nextTakeSeq(takes: PersistedTake[]): number {
  const last = takes[takes.length - 1];
  return last ? last.seq + 1 : 1;
}

export function appendTake(
  takes: PersistedTake[],
  partial: { lang: string; code: string; results: StudentRunResult | null },
): PersistedTake[] {
  return [
    ...takes,
    {
      seq: nextTakeSeq(takes),
      ts: new Date().toISOString(),
      lang: partial.lang,
      code: partial.code,
      results: partial.results,
    },
  ];
}

function sessionTracer(sessionId: string): JsonlTracer {
  return new JsonlTracer(path.join(paths.logsDir, `${sessionId}.jsonl`));
}

/** Student-safe vocab snapshot — locked term text never leaves the server. */
export function vocabFor(entry: SessionEntry): { lockedCount: number; earned: string[] } {
  const locked = new Set(entry.session.lockedTerms);
  return {
    lockedCount: locked.size,
    earned: entry.card.leak_terms.filter((t) => !locked.has(t)),
  };
}

export async function newEntry(card: ProblemCard, cardName: string): Promise<SessionEntry> {
  const sessionId = randomUUID();
  const now = new Date().toISOString();
  const { models } = await loadSettings();
  const session = new TutorSession(
    card,
    { teacher: models.teacher, gate: models.gate, unlock: models.unlock },
    {
      tracer: sessionTracer(sessionId),
    },
  );
  const persisted: PersistedSession = {
    id: sessionId,
    cardName,
    title: card.title,
    startedAt: now,
    updatedAt: now,
    solved: false,
    lang: '',
    code: '',
    notes: [],
    takes: [],
    lastRun: null,
    engine: {
      transcript: [...session.transcript],
      lockedTerms: [...session.lockedTerms],
      turnCounter: session.turn,
    },
  };
  await saveSession(persisted);
  const entry: SessionEntry = { session, card, cardName, persisted };
  sessions.set(sessionId, entry);
  return entry;
}

export async function getOrRestore(id: string): Promise<SessionEntry | null> {
  const hit = sessions.get(id);
  if (hit) return hit;
  const persisted = await loadSession(id);
  if (!persisted) return null;
  try {
    const card = await loadCard(persisted.cardName);
    const { models } = await loadSettings();
    const session = new TutorSession(
      card,
      { teacher: models.teacher, gate: models.gate, unlock: models.unlock },
      {
        restore: persisted.engine,
        tracer: sessionTracer(id),
      },
    );
    const entry: SessionEntry = {
      session,
      card,
      cardName: persisted.cardName,
      persisted,
    };
    sessions.set(id, entry);
    return entry;
  } catch {
    return null;
  }
}

export async function ensureCases(entry: SessionEntry): Promise<CaseSpec[]> {
  if (entry.cases) return entry.cases;
  const judge = entry.card.judge;
  const official = await extractCases(entry.card.examples, { stress: false, judge });
  const stressRows = entry.card.stress ?? [];
  const stress =
    stressRows.length > 0
      ? await extractCases(stressRows, { stress: true, judge })
      : [];
  entry.cases = [...official, ...stress];
  return entry.cases;
}

export function officialAllPass(result: StudentRunResult): boolean {
  if (result.error) return false;
  const official = result.cases.filter((c) => !c.stress);
  return official.length > 0 && official.every((c) => c.pass);
}

export async function persistEntry(entry: SessionEntry): Promise<void> {
  entry.persisted.engine = {
    transcript: [...entry.session.transcript],
    lockedTerms: [...entry.session.lockedTerms],
    turnCounter: entry.session.turn,
  };
  entry.persisted.updatedAt = new Date().toISOString();
  await saveSession(entry.persisted);
}
