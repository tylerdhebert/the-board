import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { URL } from 'node:url';
import {
  DEFAULT_MODELS,
  TutorSession,
  extractCases,
  getOrIngestCard,
  listCards,
  loadCard,
  loadSnippets,
  runStudentCode,
  studentSafeProblem,
  toSlug,
  type CaseSpec,
  type ProblemCard,
} from './engine.js';
import { attachLspBridge, lspInfo } from './lsp.js';

const PORT = Number(process.env.PORT ?? 8787);

type SessionEntry = {
  session: TutorSession;
  card: ProblemCard;
  cardName: string;
  cases?: CaseSpec[];
};

const sessions = new Map<string, SessionEntry>();

const RUNNABLE = new Set(['python', 'typescript', 'javascript', 'csharp']);

const LANG_SLUG: Record<string, string> = {
  python: 'python3',
  typescript: 'typescript',
  javascript: 'javascript',
  csharp: 'csharp',
};

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

function sendEvent(res: http.ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
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

  if (method === 'GET' && pathname === '/api/lsp/info') {
    sendJson(res, 200, lspInfo());
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
      sessions.set(sessionId, {
        session: new TutorSession(card, DEFAULT_MODELS),
        card,
        cardName,
      });
      sendJson(res, 200, {
        sessionId,
        problem: { ...studentSafeProblem(card), codeSnippets: await loadSnippets(cardName) },
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
      const { card, cached, snippets } = await getOrIngestCard(query);
      const sessionId = randomUUID();
      sessions.set(sessionId, {
        session: new TutorSession(card, DEFAULT_MODELS),
        card,
        cardName: toSlug(query),
      });
      sendJson(res, 200, {
        sessionId,
        problem: { ...studentSafeProblem(card), codeSnippets: snippets },
        cached,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 502, { error: message });
    }
    return;
  }

  const runMatch = pathname.match(/^\/api\/session\/([^/]+)\/run$/);
  if (method === 'POST' && runMatch) {
    const sessionId = runMatch[1]!;
    const entry = sessions.get(sessionId);
    if (!entry) {
      sendJson(res, 404, { error: 'session not found' });
      return;
    }
    const body = (await readJsonBody(req)) as { code?: string; language?: string };
    const code = body.code;
    const language = body.language;
    if (typeof code !== 'string' || !code) {
      sendJson(res, 400, { error: 'code is required' });
      return;
    }
    if (typeof language !== 'string' || !RUNNABLE.has(language)) {
      sendJson(res, 400, { error: 'unsupported language' });
      return;
    }
    try {
      if (!entry.cases) {
        entry.cases = await extractCases(entry.card.examples);
      }
      const snippets = await loadSnippets(entry.cardName);
      const slug = LANG_SLUG[language] ?? language;
      const scaffold = snippets.find((s) => s.langSlug === slug)?.code;
      const result = await runStudentCode(
        code,
        language as 'python' | 'typescript' | 'javascript' | 'csharp',
        entry.cases,
        scaffold,
      );
      sendJson(res, 200, result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { cases: [], error: message });
    }
    return;
  }

  const submitMatch = pathname.match(/^\/api\/session\/([^/]+)\/submit$/);
  if (method === 'POST' && submitMatch) {
    const sessionId = submitMatch[1]!;
    const entry = sessions.get(sessionId);
    if (!entry) {
      sendJson(res, 404, { error: 'session not found' });
      return;
    }
    const body = (await readJsonBody(req)) as { message?: string };
    const message = body.message;
    if (typeof message !== 'string') {
      sendJson(res, 400, { error: 'message is required' });
      return;
    }
    res.writeHead(200, {
      ...CORS,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    try {
      const result = await entry.session.submit(message, (stage) => sendEvent(res, 'stage', { stage }));
      sendEvent(res, 'result', {
        reply: result.reply,
        mode: result.mode,
        unlockedThisTurn: result.unlockedThisTurn,
        redrafted: result.redrafted,
      });
      res.end();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      sendEvent(res, 'error', { error: errMsg });
      res.end();
    }
    return;
  }

  sendJson(res, 404, { error: 'not found' });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    if (!res.headersSent) {
      sendJson(res, 500, { error: message });
    } else {
      res.end();
    }
  });
});

attachLspBridge(server);

server.listen(PORT, () => {
  console.log(`tutor server on http://localhost:${PORT}`);
});
