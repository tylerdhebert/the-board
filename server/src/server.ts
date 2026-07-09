import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { URL } from 'node:url';
import {
  DEFAULT_MODELS,
  TutorSession,
  getOrIngestCard,
  listCards,
  loadCard,
  studentSafeProblem,
} from './engine.js';

const PORT = Number(process.env.PORT ?? 8787);
const sessions = new Map<string, TutorSession>();

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    ...CORS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  return JSON.parse(raw) as unknown;
}

async function handle(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const pathname = url.pathname;

  if (method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  if (method === 'GET' && pathname === '/api/cards') {
    sendJson(res, 200, await listCards());
    return;
  }

  if (method === 'POST' && pathname === '/api/session') {
    const body = (await readJsonBody(req)) as { cardName?: string };
    const cardName = body.cardName;
    if (typeof cardName !== 'string' || !cardName) {
      sendJson(res, 400, { error: 'cardName is required' });
      return;
    }
    try {
      const card = await loadCard(cardName);
      const sessionId = randomUUID();
      sessions.set(sessionId, new TutorSession(card, DEFAULT_MODELS));
      sendJson(res, 200, {
        sessionId,
        problem: studentSafeProblem(card),
      });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        sendJson(res, 404, { error: `card not found: ${cardName}` });
        return;
      }
      throw err;
    }
    return;
  }

  if (method === 'POST' && pathname === '/api/start') {
    const body = (await readJsonBody(req)) as { query?: string };
    const query = body.query;
    if (typeof query !== 'string' || !query.trim()) {
      sendJson(res, 400, { error: 'query is required' });
      return;
    }
    try {
      const { card, cached } = await getOrIngestCard(query);
      const sessionId = randomUUID();
      sessions.set(sessionId, new TutorSession(card, DEFAULT_MODELS));
      sendJson(res, 200, {
        sessionId,
        problem: studentSafeProblem(card),
        cached,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 502, { error: message });
    }
    return;
  }

  const submitMatch = pathname.match(/^\/api\/session\/([^/]+)\/submit$/);
  if (method === 'POST' && submitMatch) {
    const sessionId = submitMatch[1]!;
    const session = sessions.get(sessionId);
    if (!session) {
      sendJson(res, 404, { error: 'session not found' });
      return;
    }
    const body = (await readJsonBody(req)) as { message?: string };
    const message = body.message;
    if (typeof message !== 'string') {
      sendJson(res, 400, { error: 'message is required' });
      return;
    }
    const result = await session.submit(message);
    sendJson(res, 200, {
      reply: result.reply,
      mode: result.mode,
      unlockedThisTurn: result.unlockedThisTurn,
      redrafted: result.redrafted,
    });
    return;
  }

  sendJson(res, 404, { error: 'not found' });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, 500, { error: message });
  });
});

server.listen(PORT, () => {
  console.log(`tutor server on http://localhost:${PORT}`);
});
