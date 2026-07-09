import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Message, StudentRunResult } from './engine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sessionsDir = path.resolve(__dirname, '../../sessions');

export type PersistedNote = {
  role: 'student' | 'tutor';
  text: string;
  mode?: string;
  unlocked?: string[];
  redrafted?: boolean;
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
  lastRun: StudentRunResult | null;
  engine: { transcript: Message[]; lockedTerms: string[]; turnCounter: number };
};

async function ensureDir(): Promise<void> {
  await mkdir(sessionsDir, { recursive: true });
}

export async function saveSession(s: PersistedSession): Promise<void> {
  await ensureDir();
  const dest = path.join(sessionsDir, `${s.id}.json`);
  const tmp = `${dest}.tmp`;
  await writeFile(tmp, JSON.stringify(s, null, 2) + '\n', 'utf8');
  try {
    await rename(tmp, dest);
  } catch (err) {
    // Windows cannot rename over an existing file.
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EEXIST' || code === 'EPERM' || code === 'EACCES') {
      await unlink(dest);
      await rename(tmp, dest);
    } else {
      throw err;
    }
  }
}

export async function loadSession(id: string): Promise<PersistedSession | null> {
  if (id.includes('/') || id.includes('\\') || id.includes('..')) return null;
  try {
    const raw = await readFile(path.join(sessionsDir, `${id}.json`), 'utf8');
    return JSON.parse(raw) as PersistedSession;
  } catch {
    return null;
  }
}

export async function listSessions(): Promise<PersistedSession[]> {
  try {
    await ensureDir();
    const entries = await readdir(sessionsDir);
    const out: PersistedSession[] = [];
    for (const entry of entries) {
      if (!entry.endsWith('.json') || entry.endsWith('.json.tmp')) continue;
      try {
        const raw = await readFile(path.join(sessionsDir, entry), 'utf8');
        out.push(JSON.parse(raw) as PersistedSession);
      } catch {
        // skip corrupt files silently
      }
    }
    return out;
  } catch {
    return [];
  }
}
