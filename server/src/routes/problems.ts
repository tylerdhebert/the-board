import type http from 'node:http';
import { listCards } from '../engine.js';
import { isEmptySession, listSessions, type PersistedSession } from '../sessionStore.js';
import { firstStudentNote } from './boot.js';
import { sendJson } from './http.js';

export async function handleProblems(
  method: string,
  pathname: string,
  res: http.ServerResponse,
): Promise<boolean> {
  if (method !== 'GET' || pathname !== '/api/problems') return false;

  const cards = await listCards();
  const allSessions = await listSessions();
  const byCard = new Map<string, PersistedSession[]>();
  for (const s of allSessions) {
    if (isEmptySession(s)) continue;
    const list = byCard.get(s.cardName) ?? [];
    list.push(s);
    byCard.set(s.cardName, list);
  }
  type ProblemRow = {
    name: string;
    title: string;
    difficulty?: string;
    status: 'new' | 'attempted' | 'solved';
    sessions: {
      id: string;
      startedAt: string;
      updatedAt: string;
      turns: number;
      solved: boolean;
      first: string;
    }[];
    latestUpdatedAt: string | null;
  };
  const rows: ProblemRow[] = [];
  for (const card of cards) {
    const sess = byCard.get(card.name) ?? [];
    sess.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const status: ProblemRow['status'] = sess.some((s) => s.solved)
      ? 'solved'
      : sess.length > 0
        ? 'attempted'
        : 'new';
    rows.push({
      name: card.name,
      title: card.title,
      ...(card.difficulty ? { difficulty: card.difficulty } : {}),
      status,
      sessions: sess.map((s) => ({
        id: s.id,
        startedAt: s.startedAt,
        updatedAt: s.updatedAt,
        turns: s.engine.turnCounter,
        solved: s.solved,
        first: firstStudentNote(s),
      })),
      latestUpdatedAt: sess[0]?.updatedAt ?? null,
    });
  }
  rows.sort((a, b) => {
    const aTouched = a.latestUpdatedAt !== null;
    const bTouched = b.latestUpdatedAt !== null;
    if (aTouched && bTouched) {
      return b.latestUpdatedAt!.localeCompare(a.latestUpdatedAt!);
    }
    if (aTouched !== bTouched) return aTouched ? -1 : 1;
    return a.title.localeCompare(b.title);
  });
  sendJson(
    res,
    200,
    rows.map(({ name, title, difficulty, status, sessions: sess }) => ({
      name,
      title,
      ...(difficulty ? { difficulty } : {}),
      status,
      sessions: sess,
    })),
  );
  return true;
}
