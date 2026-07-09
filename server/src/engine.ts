import { access, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CodexCliClient,
  TutorSession,
  fetchProblem,
  slugFromUrl,
  type CodeSnippet,
  type ProblemCard,
  type SessionModels,
} from '../../engine/src/index.js';
import { ingest } from '../../engine/src/ingest.js';
import { extractCases, type CaseSpec } from '../../engine/src/exampleCases.js';
import { runStudentCode, type StudentRunResult } from '../../engine/src/runStudentCode.js';

export { TutorSession, extractCases, runStudentCode };
export type { CodeSnippet, ProblemCard, SessionModels, CaseSpec, StudentRunResult };

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

export function toSlug(query: string): string {
  const trimmed = query.trim();
  if (
    trimmed.includes('leetcode.com') ||
    trimmed.includes('/problems/') ||
    trimmed.startsWith('http')
  ) {
    return slugFromUrl(trimmed);
  }
  return trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function readSnippets(filePath: string): Promise<CodeSnippet[]> {
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw) as CodeSnippet[];
  } catch {
    return [];
  }
}

/** Starter scaffolds for a built-in card (by name), if any were cached. */
export async function loadSnippets(name: string): Promise<CodeSnippet[]> {
  assertSafeCardName(name);
  return readSnippets(path.join(cardsDir, `${name}.snippets.json`));
}

export async function getOrIngestCard(
  query: string,
  model = 'gpt-5.5',
): Promise<{ card: ProblemCard; verified: boolean; cached: boolean; snippets: CodeSnippet[] }> {
  const slug = toSlug(query);
  assertSafeCardName(slug);
  const cachePath = path.join(cardsDir, `${slug}.card.json`);
  const snippetsPath = path.join(cardsDir, `${slug}.snippets.json`);

  try {
    await access(cachePath);
    const raw = await readFile(cachePath, 'utf8');
    const card = JSON.parse(raw) as ProblemCard;
    return { card, verified: true, cached: true, snippets: await readSnippets(snippetsPath) };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') throw err;
  }

  let problem;
  try {
    problem = await fetchProblem(slug);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`failed to fetch problem "${slug}": ${message}`);
  }

  const client = new CodexCliClient();
  const { card, verification } = await ingest(client, problem.statement, model);
  await writeFile(cachePath, JSON.stringify(card, null, 2) + '\n', 'utf8');
  await writeFile(snippetsPath, JSON.stringify(problem.codeSnippets, null, 2) + '\n', 'utf8');
  return { card, verified: verification.ok, cached: false, snippets: problem.codeSnippets };
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
