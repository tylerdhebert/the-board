import type http from 'node:http';
import {
  createClient,
  getOrIngestCard,
  loadCard,
  loadSnippets,
  studentSafeProblem,
  toSlug,
} from '../engine.js';
import { loadSettings } from '../settings.js';
import { getOrRestore, newEntry, vocabFor } from './context.js';
import { readJsonBody, sendJson } from './http.js';

export async function handleCreateSession(
  method: string,
  pathname: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<boolean> {
  if (method === 'POST' && pathname === '/api/session') {
    const body = (await readJsonBody(req)) as { cardName?: string };
    const cardName = body.cardName;
    if (typeof cardName !== 'string' || !cardName) {
      sendJson(res, 400, { error: 'cardName is required' });
      return true;
    }
    try {
      const card = await loadCard(cardName);
      const entry = await newEntry(card, cardName);
      sendJson(res, 200, {
        sessionId: entry.persisted.id,
        problem: { ...studentSafeProblem(card), codeSnippets: await loadSnippets(cardName) },
        vocab: vocabFor(entry),
      });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        sendJson(res, 404, { error: `card not found: ${cardName}` });
        return true;
      }
      throw err;
    }
    return true;
  }

  if (method === 'POST' && pathname === '/api/start') {
    const body = (await readJsonBody(req)) as { query?: string };
    const query = body.query;
    if (typeof query !== 'string' || !query.trim()) {
      sendJson(res, 400, { error: 'query is required' });
      return true;
    }
    try {
      const settings = await loadSettings();
      const ingest = settings.models.ingest;
      const { card, cached, snippets } = await getOrIngestCard(query, {
        client: createClient(ingest.backend),
        model: ingest.model,
      });
      const entry = await newEntry(card, toSlug(query));
      sendJson(res, 200, {
        sessionId: entry.persisted.id,
        problem: { ...studentSafeProblem(card), codeSnippets: snippets },
        cached,
        vocab: vocabFor(entry),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 502, { error: message });
    }
    return true;
  }

  const getSessionMatch = pathname.match(/^\/api\/session\/([^/]+)$/);
  if (method === 'GET' && getSessionMatch) {
    const sessionId = getSessionMatch[1]!;
    const entry = await getOrRestore(sessionId);
    if (!entry) {
      sendJson(res, 404, { error: 'session not found' });
      return true;
    }
    sendJson(res, 200, {
      sessionId: entry.persisted.id,
      cardName: entry.cardName,
      problem: {
        ...studentSafeProblem(entry.card),
        codeSnippets: await loadSnippets(entry.cardName),
      },
      notes: entry.persisted.notes,
      code: entry.persisted.code,
      lang: entry.persisted.lang,
      takes: entry.persisted.takes,
      solved: entry.persisted.solved,
      vocab: vocabFor(entry),
    });
    return true;
  }

  return false;
}
