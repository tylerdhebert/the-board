import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TutorSession,
  type ProblemCard,
  type SessionModels,
} from '../../engine/src/index.js';

export { TutorSession };
export type { ProblemCard, SessionModels };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const cardsDir = path.join(repoRoot, 'cards');

export const DEFAULT_MODELS: SessionModels = {
  teacher: { backend: 'codex', model: 'gpt-5.5' },
  gate: { backend: 'codex', model: 'gpt-5.4-mini' },
  unlock: { backend: 'codex', model: 'gpt-5.4-mini' },
};

export function studentSafeProblem(card: ProblemCard): {
  title: string;
  statement: string;
  constraints: string;
} {
  return {
    title: card.title,
    statement: card.statement,
    constraints: card.constraints,
  };
}

function assertSafeCardName(name: string): void {
  if (name.includes('/') || name.includes('\\') || name.includes('..')) {
    throw new Error('invalid card name');
  }
}

export async function loadCard(name: string): Promise<ProblemCard> {
  assertSafeCardName(name);
  const filePath = path.join(cardsDir, `${name}.card.json`);
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw) as ProblemCard;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      const missing = new Error(`card not found: ${name}`);
      (missing as Error & { code?: string }).code = 'ENOENT';
      throw missing;
    }
    throw err;
  }
}

export async function listCards(): Promise<{ name: string; title: string }[]> {
  const entries = await readdir(cardsDir);
  const cards: { name: string; title: string }[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.card.json')) continue;
    const name = entry.slice(0, -'.card.json'.length);
    const card = await loadCard(name);
    cards.push({ name, title: card.title });
  }
  return cards;
}
