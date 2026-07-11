import { mkdir, readdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { appPaths } from './appPaths.js';
import type { PersistedSession, PersistedTake } from './sessionStore.js';
import type { StudentRunResult } from './engine.js';

const LANG_EXT: Record<string, string> = {
  python: 'py',
  typescript: 'ts',
  javascript: 'js',
  csharp: 'cs',
};

const FAIL_DETAIL_CAP = 96;

function scratchRoot(): string {
  return appPaths().teacherScratchDir;
}

/** Session ids are UUIDs or restored ids — keep path construction plainly safe. */
export function assertSafeScratchSessionId(id: string): void {
  if (
    !id ||
    id.includes('..') ||
    id.includes('/') ||
    id.includes('\\') ||
    id.includes('\0') ||
    !/^[A-Za-z0-9_-]+$/.test(id)
  ) {
    throw new Error('invalid session id for teacher scratch');
  }
}

export function editorExtForLang(lang: string): string {
  const key = lang.trim().toLowerCase();
  return LANG_EXT[key] ?? 'txt';
}

function truncateDetail(text: string, cap = FAIL_DETAIL_CAP): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= cap) return oneLine;
  return `${oneLine.slice(0, cap - 1)}…`;
}

function formatFailingCase(run: StudentRunResult): string {
  if (run.error && run.cases.length === 0) {
    return truncateDetail(run.error);
  }
  const officialFail = run.cases.find((c) => !c.stress && !c.pass);
  const fail = officialFail ?? run.cases.find((c) => !c.pass);
  if (!fail) return 'none';
  let detail = fail.display;
  if (fail.error) {
    detail += ` (${fail.error})`;
  } else {
    detail += ` (got ${fail.got}, expected ${fail.expected})`;
  }
  return truncateDetail(detail);
}

/** Newest take whose code/lang match the current editor and whose results are non-null. */
export function matchingRunTake(
  takes: PersistedTake[],
  code: string,
  lang: string,
): PersistedTake | null {
  for (let i = takes.length - 1; i >= 0; i--) {
    const t = takes[i]!;
    if (t.code === code && t.lang === lang && t.results != null) return t;
  }
  return null;
}

export function renderBoardContext(persisted: PersistedSession, editorExt: string): string {
  const newest = persisted.takes[persisted.takes.length - 1];
  const attempt = newest ? newest.seq : 0;
  const lang = persisted.lang.trim() ? persisted.lang : 'unknown';
  const match = matchingRunTake(persisted.takes, persisted.code, persisted.lang);

  let passPart = 'not run';
  let failPart = 'none';
  if (match?.results) {
    const { cases, error } = match.results;
    if (error && cases.length === 0) {
      passPart = '0/0 passing';
      failPart = truncateDetail(error);
    } else {
      const official = cases.filter((c) => !c.stress);
      const passed = official.filter((c) => c.pass).length;
      passPart = `${passed}/${official.length} passing`;
      failPart = formatFailingCase(match.results);
    }
  }

  return (
    `BOARD: attempt ${attempt} · ${passPart} · ${lang} · last failing case: ${failPart}\n` +
    `The student's editor is at ./editor.${editorExt} — read it if you need it.`
  );
}

/**
 * Ensure the session scratch dir exists, drop stale editor.* siblings, write
 * the current buffer as UTF-8 editor.<ext>. Returns the session cwd + ext.
 */
export async function materializeTeacherEditor(
  sessionId: string,
  code: string,
  lang: string,
): Promise<{ cwd: string; ext: string }> {
  assertSafeScratchSessionId(sessionId);
  const ext = editorExtForLang(lang);
  const cwd = path.join(scratchRoot(), sessionId);
  await mkdir(cwd, { recursive: true });
  const entries = await readdir(cwd);
  await Promise.all(
    entries
      .filter((name) => name.startsWith('editor.'))
      .map((name) => unlink(path.join(cwd, name)).catch(() => {})),
  );
  await writeFile(path.join(cwd, `editor.${ext}`), code, 'utf8');
  return { cwd, ext };
}
