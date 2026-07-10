import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { URL } from 'node:url';
import {
  DEFAULT_MODELS,
  JsonlTracer,
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
import {
  deleteSessions,
  isEmptySession,
  listSessions,
  loadSession,
  saveSession,
  type PersistedSession,
} from './sessionStore.js';

const PORT = Number(process.env.PORT ?? 8787);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const logsDir = path.join(repoRoot, 'logs');
mkdirSync(logsDir, { recursive: true });

function sessionTracer(sessionId: string): JsonlTracer {
  return new JsonlTracer(path.join(logsDir, `${sessionId}.jsonl`));
}

function firstStudentNote(s: PersistedSession): string {
  const note = s.notes.find((n) => n.role === 'student');
  if (!note) return '';
  const text = note.text;
  return text.length > 80 ? text.slice(0, 80) : text;
}

async function pruneEmptySessions(): Promise<void> {
  const all = await listSessions();
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const stale = all.filter(
    (s) => isEmptySession(s) && Date.parse(s.updatedAt) < cutoff,
  );
  if (stale.length === 0) return;
  deleteSessions(stale.map((s) => s.id));
  console.log(`pruned ${stale.length} empty session(s)`);
}

type SessionEntry = {
  session: TutorSession;
  card: ProblemCard;
  cardName: string;
  cases?: CaseSpec[];
  persisted: PersistedSession;
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
  'Access-Control-Allow-Methods': 'POST, GET, PUT, OPTIONS',
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

async function newEntry(card: ProblemCard, cardName: string): Promise<SessionEntry> {
  const sessionId = randomUUID();
  const now = new Date().toISOString();
  const session = new TutorSession(card, DEFAULT_MODELS, {
    tracer: sessionTracer(sessionId),
  });
  const persisted: PersistedSession = {
    id: sessionId,
    cardName,
    title: card.title,
    startedAt: now,
    updatedAt: now,
    solved: false,
    lang: '',
    code: '',
    notes: [],
    lastRun: null,
    engine: {
      transcript: [...session.transcript],
      lockedTerms: [...session.lockedTerms],
      turnCounter: session.turn,
    },
  };
  await saveSession(persisted);
  const entry: SessionEntry = { session, card, cardName, persisted };
  sessions.set(sessionId, entry);
  return entry;
}

async function getOrRestore(id: string): Promise<SessionEntry | null> {
  const hit = sessions.get(id);
  if (hit) return hit;
  const persisted = await loadSession(id);
  if (!persisted) return null;
  try {
    const card = await loadCard(persisted.cardName);
    const session = new TutorSession(card, DEFAULT_MODELS, {
      restore: persisted.engine,
      tracer: sessionTracer(id),
    });
    const entry: SessionEntry = {
      session,
      card,
      cardName: persisted.cardName,
      persisted,
    };
    sessions.set(id, entry);
    return entry;
  } catch {
    return null;
  }
}

async function persistEntry(entry: SessionEntry): Promise<void> {
  entry.persisted.engine = {
    transcript: [...entry.session.transcript],
    lockedTerms: [...entry.session.lockedTerms],
    turnCounter: entry.session.turn,
  };
  entry.persisted.updatedAt = new Date().toISOString();
  await saveSession(entry.persisted);
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

  if (method === 'GET' && pathname === '/api/problems') {
    const cards = await listCards();
    const allSessions = await listSessions();
    const byCard = new Map<string, PersistedSession[]>();
    for (const s of allSessions) {
      if (isEmptySession(s)) continue;
      const list = byCard.get(s.cardName) ?? [];
      list.push(s);
      byCard.set(s.cardName, list);
    }
    type ProblemRow = {
      name: string;
      title: string;
      status: 'new' | 'attempted' | 'solved';
      sessions: {
        id: string;
        startedAt: string;
        updatedAt: string;
        turns: number;
        solved: boolean;
        first: string;
      }[];
      latestUpdatedAt: string | null;
    };
    const rows: ProblemRow[] = [];
    for (const card of cards) {
      const sess = byCard.get(card.name) ?? [];
      sess.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      const status: ProblemRow['status'] = sess.some((s) => s.solved)
        ? 'solved'
        : sess.length > 0
          ? 'attempted'
          : 'new';
      rows.push({
        name: card.name,
        title: card.title,
        status,
        sessions: sess.map((s) => ({
          id: s.id,
          startedAt: s.startedAt,
          updatedAt: s.updatedAt,
          turns: s.engine.turnCounter,
          solved: s.solved,
          first: firstStudentNote(s),
        })),
        latestUpdatedAt: sess[0]?.updatedAt ?? null,
      });
    }
    rows.sort((a, b) => {
      const aTouched = a.latestUpdatedAt !== null;
      const bTouched = b.latestUpdatedAt !== null;
      if (aTouched && bTouched) {
        return b.latestUpdatedAt!.localeCompare(a.latestUpdatedAt!);
      }
      if (aTouched !== bTouched) return aTouched ? -1 : 1;
      return a.title.localeCompare(b.title);
    });
    sendJson(
      res,
      200,
      rows.map(({ name, title, status, sessions: sess }) => ({ name, title, status, sessions: sess })),
    );
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
      const entry = await newEntry(card, cardName);
      sendJson(res, 200, {
        sessionId: entry.persisted.id,
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
      const entry = await newEntry(card, toSlug(query));
      sendJson(res, 200, {
        sessionId: entry.persisted.id,
        problem: { ...studentSafeProblem(card), codeSnippets: snippets },
        cached,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 502, { error: message });
    }
    return;
  }

  const editorMatch = pathname.match(/^\/api\/session\/([^/]+)\/editor$/);
  if (method === 'PUT' && editorMatch) {
    const sessionId = editorMatch[1]!;
    const entry = await getOrRestore(sessionId);
    if (!entry) {
      sendJson(res, 404, { error: 'session not found' });
      return;
    }
    const body = (await readJsonBody(req)) as { code?: string; lang?: string };
    if (typeof body.code !== 'string' || typeof body.lang !== 'string') {
      sendJson(res, 400, { error: 'code and lang are required' });
      return;
    }
    entry.persisted.code = body.code;
    entry.persisted.lang = body.lang;
    await persistEntry(entry);
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  const getSessionMatch = pathname.match(/^\/api\/session\/([^/]+)$/);
  if (method === 'GET' && getSessionMatch) {
    const sessionId = getSessionMatch[1]!;
    const entry = await getOrRestore(sessionId);
    if (!entry) {
      sendJson(res, 404, { error: 'session not found' });
      return;
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
      lastRun: entry.persisted.lastRun,
      solved: entry.persisted.solved,
    });
    return;
  }

  const runMatch = pathname.match(/^\/api\/session\/([^/]+)\/run$/);
  if (method === 'POST' && runMatch) {
    const sessionId = runMatch[1]!;
    const entry = await getOrRestore(sessionId);
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
      entry.persisted.lastRun = result;
      entry.persisted.code = code;
      entry.persisted.lang = language;
      if (result.cases.length > 0 && result.cases.every((c) => c.pass)) {
        entry.persisted.solved = true;
      }
      await persistEntry(entry);
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
    const entry = await getOrRestore(sessionId);
    if (!entry) {
      sendJson(res, 404, { error: 'session not found' });
      return;
    }
    const body = (await readJsonBody(req)) as { message?: string; display?: string };
    const message = body.message;
    if (typeof message !== 'string') {
      sendJson(res, 400, { error: 'message is required' });
      return;
    }
    const display = typeof body.display === 'string' ? body.display : undefined;
    res.writeHead(200, {
      ...CORS,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    try {
      const result = await entry.session.submit(message, (stage) => sendEvent(res, 'stage', { stage }));
      entry.persisted.notes.push({
        role: 'student',
        text: display ?? message,
      });
      entry.persisted.notes.push({
        role: 'tutor',
        text: result.reply,
        mode: result.mode,
        unlocked: result.unlockedThisTurn,
        redrafted: result.redrafted,
      });
      // Reply first, persist after — a disk-write failure must never eat a
      // reply the tutor already produced.
      sendEvent(res, 'result', {
        reply: result.reply,
        mode: result.mode,
        unlockedThisTurn: result.unlockedThisTurn,
        redrafted: result.redrafted,
      });
      res.end();
      try {
        await persistEntry(entry);
      } catch (persistErr) {
        console.warn('failed to persist session', sessionId, persistErr);
      }
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
  void pruneEmptySessions()
    .catch((err) => console.warn('prune failed', err))
    .finally(() => {
      console.log(`tutor server on http://localhost:${PORT}`);
    });
});
