import type http from 'node:http';
import { appendTake, getOrRestore, persistEntry } from './context.js';
import { CORS, readJsonBody, sendJson } from './http.js';

export async function handleEditor(
  method: string,
  pathname: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<boolean> {
  const editorMatch = pathname.match(/^\/api\/session\/([^/]+)\/editor$/);
  if (method === 'PUT' && editorMatch) {
    const sessionId = editorMatch[1]!;
    const entry = await getOrRestore(sessionId);
    if (!entry) {
      sendJson(res, 404, { error: 'session not found' });
      return true;
    }
    const body = (await readJsonBody(req)) as { code?: string; lang?: string };
    if (typeof body.code !== 'string' || typeof body.lang !== 'string') {
      sendJson(res, 400, { error: 'code and lang are required' });
      return true;
    }
    entry.persisted.code = body.code;
    entry.persisted.lang = body.lang;
    await persistEntry(entry);
    res.writeHead(204, CORS);
    res.end();
    return true;
  }

  const takeMatch = pathname.match(/^\/api\/session\/([^/]+)\/take$/);
  if (method === 'POST' && takeMatch) {
    const sessionId = takeMatch[1]!;
    const entry = await getOrRestore(sessionId);
    if (!entry) {
      sendJson(res, 404, { error: 'session not found' });
      return true;
    }
    const body = (await readJsonBody(req)) as { code?: string; lang?: string };
    if (typeof body.code !== 'string' || typeof body.lang !== 'string') {
      sendJson(res, 400, { error: 'code and lang are required' });
      return true;
    }
    const newest = entry.persisted.takes[entry.persisted.takes.length - 1];
    if (newest && newest.code === body.code && newest.lang === body.lang) {
      sendJson(res, 200, { takes: entry.persisted.takes });
      return true;
    }
    entry.persisted.takes = appendTake(entry.persisted.takes, {
      code: body.code,
      lang: body.lang,
      results: null,
    });
    await persistEntry(entry);
    sendJson(res, 200, { takes: entry.persisted.takes });
    return true;
  }

  return false;
}
