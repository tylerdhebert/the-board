import type http from 'node:http';
import { loadSnippets, runStudentCode } from '../engine.js';
import {
  appendTake,
  ensureCases,
  getOrRestore,
  LANG_SLUG,
  officialAllPass,
  persistEntry,
  RUNNABLE,
} from './context.js';
import { readJsonBody, sendJson } from './http.js';

export async function handleRun(
  method: string,
  pathname: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<boolean> {
  const runMatch = pathname.match(/^\/api\/session\/([^/]+)\/run$/);
  if (method !== 'POST' || !runMatch) return false;

  const sessionId = runMatch[1]!;
  const entry = await getOrRestore(sessionId);
  if (!entry) {
    sendJson(res, 404, { error: 'session not found' });
    return true;
  }
  const body = (await readJsonBody(req)) as {
    code?: string;
    language?: string;
    dirty?: { code: string; lang: string };
  };
  const code = body.code;
  const language = body.language;
  if (typeof code !== 'string' || !code) {
    sendJson(res, 400, { error: 'code is required' });
    return true;
  }
  if (typeof language !== 'string' || !RUNNABLE.has(language)) {
    sendJson(res, 400, { error: 'unsupported language' });
    return true;
  }
  try {
    if (body.dirty && typeof body.dirty.code === 'string' && typeof body.dirty.lang === 'string') {
      const newest = entry.persisted.takes[entry.persisted.takes.length - 1];
      if (
        !newest ||
        newest.code !== body.dirty.code ||
        newest.lang !== body.dirty.lang
      ) {
        entry.persisted.takes = appendTake(entry.persisted.takes, {
          code: body.dirty.code,
          lang: body.dirty.lang,
          results: null,
        });
      }
    }
    const cases = await ensureCases(entry);
    const snippets = await loadSnippets(entry.cardName);
    const slug = LANG_SLUG[language] ?? language;
    const scaffold = snippets.find((s) => s.langSlug === slug)?.code;
    const runResult = await runStudentCode(
      code,
      language as 'python' | 'typescript' | 'javascript' | 'csharp',
      cases,
      scaffold,
      entry.card.judge,
    );
    const { console: consoleOutput, ...result } = runResult;
    const newest = entry.persisted.takes[entry.persisted.takes.length - 1];
    if (
      newest &&
      newest.results === null &&
      newest.code === code &&
      newest.lang === language
    ) {
      entry.persisted.takes = entry.persisted.takes.map((t) =>
        t.seq === newest.seq ? { ...t, results: result } : t,
      );
    } else {
      entry.persisted.takes = appendTake(entry.persisted.takes, {
        code,
        lang: language,
        results: result,
      });
    }
    entry.persisted.lastRun = result;
    entry.persisted.code = code;
    entry.persisted.lang = language;
    if (officialAllPass(result)) {
      entry.persisted.solved = true;
    }
    await persistEntry(entry);
    sendJson(res, 200, {
      result,
      takes: entry.persisted.takes,
      ...(consoleOutput ? { consoleOutput } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, 500, { cases: [], error: message });
  }
  return true;
}
