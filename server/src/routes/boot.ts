import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { appPaths } from '../appPaths.js';
import {
  deleteSessions,
  isEmptySession,
  listSessions,
} from '../sessionStore.js';

const paths = appPaths();

export function firstStudentNote(s: { notes: { role: string; text: string }[] }): string {
  const note = s.notes.find((n) => n.role === 'student');
  if (!note) return '';
  const text = note.text;
  return text.length > 80 ? text.slice(0, 80) : text;
}

export async function pruneEmptySessions(): Promise<void> {
  const all = await listSessions();
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const stale = all.filter(
    (s) => isEmptySession(s) && Date.parse(s.updatedAt) < cutoff,
  );
  if (stale.length === 0) return;
  deleteSessions(stale.map((s) => s.id));
  console.log(`pruned ${stale.length} empty session(s)`);
}

export async function seedCardsIfNeeded(): Promise<void> {
  let empty = false;
  try {
    const entries = await readdir(paths.cardsDir);
    empty = entries.length === 0;
  } catch {
    empty = true;
  }
  if (!empty) return;
  let seeds: string[];
  try {
    seeds = await readdir(paths.seedCardsDir);
  } catch {
    // Seed dir missing — skip silently (resolve exists-check at use site).
    return;
  }
  await mkdir(paths.cardsDir, { recursive: true });
  await Promise.all(
    seeds
      .filter((name) => name.endsWith('.card.json') || name.endsWith('.snippets.json'))
      .map((name) =>
        cp(path.join(paths.seedCardsDir, name), path.join(paths.cardsDir, name)),
      ),
  );
}

export async function sweepTeacherScratch(): Promise<void> {
  try {
    const root = paths.teacherScratchDir;
    const sessions = await listSessions();
    const live = new Set(sessions.map((s) => s.id));
    const entries = await readdir(root, { withFileTypes: true });
    await Promise.all(
      entries
        .filter((ent) => ent.isDirectory() && !live.has(ent.name))
        .map((ent) => rm(path.join(root, ent.name), { recursive: true, force: true })),
    );
  } catch {
    // Sweep failure must never block boot.
  }
}
