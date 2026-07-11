import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { URL } from 'node:url';
import { appPaths } from './appPaths.js';
import {
  JsonlTracer,
  TutorSession,
  createClient,
  extractCases,
  generateStressCases,
  getOrIngestCard,
  listCards,
  loadCard,
  loadSnippets,
  runStudentCode,
  saveCard,
  studentSafeProblem,
  toSlug,
  type CaseSpec,
  type ProblemCard,
  type StudentRunResult,
} from './engine.js';
import { attachLspBridge, lspInfo } from './lsp.js';
import {
  deleteSessions,
  isEmptySession,
  listSessions,
  loadSession,
  saveSession,
  type PersistedSession,
  type PersistedTake,
} from './sessionStore.js';
import { loadSettings, saveSettings, type AppSettings } from './settings.js';
import {
  materializeTeacherEditor,
  renderBoardContext,
} from './teacherScratch.js';

const PORT = Number(process.env.PORT ?? 8787);
const paths = appPaths();
// Engine package cannot import server — push resolved locations via env before first use.
process.env.TUTOR_LOGS_DIR = paths.logsDir;
process.env.TUTOR_RUN_SCRATCH_DIR = paths.runScratchDir;
mkdirSync(paths.logsDir, { recursive: true });

function nextTakeSeq(takes: PersistedTake[]): number {
  const last = takes[takes.length - 1];
  return last ? last.seq + 1 : 1;
}

function appendTake(
  takes: PersistedTake[],
  partial: { lang: string; code: string; results: StudentRunResult | null },
): PersistedTake[] {
  return [
    ...takes,
    {
      seq: nextTakeSeq(takes),
      ts: new Date().toISOString(),
      lang: partial.lang,
      code: partial.code,
      results: partial.results,
    },
  ];
}

function sessionTracer(sessionId: string): JsonlTracer {
  return new JsonlTracer(path.join(paths.logsDir, `${sessionId}.jsonl`));
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

async function seedCardsIfNeeded(): Promise<void> {
  let empty = false;
  try {
    const entries = await readdir(paths.cardsDir);
    empty = entries.length === 0;
  } catch {
    empty = true;
  }
  if (!empty) return;
  let seeds: string[];
  try {
    seeds = await readdir(paths.seedCardsDir);
  } catch {
    // Seed dir missing — skip silently (resolve exists-check at use site).
    return;
  }
  await mkdir(paths.cardsDir, { recursive: true });
  await Promise.all(
    seeds
      .filter((name) => name.endsWith('.card.json') || name.endsWith('.snippets.json'))
      .map((name) =>
        cp(path.join(paths.seedCardsDir, name), path.join(paths.cardsDir, name)),
      ),
  );
}

async function sweepTeacherScratch(): Promise<void> {
  try {
    const root = paths.teacherScratchDir;
    const sessions = await listSessions();
    const live = new Set(sessions.map((s) => s.id));
    const entries = await readdir(root, { withFileTypes: true });
    await Promise.all(
      entries
        .filter((ent) => ent.isDirectory() && !live.has(ent.name))
        .map((ent) => rm(path.join(root, ent.name), { recursive: true, force: true })),
    );
  } catch {
    // Sweep failure must never block boot.
  }
}

const STATIC_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
};

function safeStaticPath(root: string, urlPath: string): string | null {
  const decoded = decodeURIComponent(urlPath);
  const rel = decoded.replace(/^\/+/, '');
  const full = path.resolve(root, rel);
  const rootResolved = path.resolve(root);
  if (full !== rootResolved && !full.startsWith(rootResolved + path.sep)) {
    return null;
  }
  return full;
}

function contentTypeFor(filePath: string): string {
  return STATIC_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

function sendFile(res: http.ServerResponse, filePath: string): void {
  const type = contentTypeFor(filePath);
  res.writeHead(200, { 'Content-Type': type });
  createReadStream(filePath).pipe(res);
}

function tryServeStatic(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
): boolean {
  if (!paths.webDistDir) return false;
  if ((req.method ?? 'GET') !== 'GET') return false;
  if (pathname.startsWith('/api') || pathname.startsWith('/lsp')) return false;

  const root = paths.webDistDir;
  const indexPath = path.join(root, 'index.html');
  let filePath = safeStaticPath(root, pathname === '/' ? '/index.html' : pathname);
  if (filePath === null) {
    res.writeHead(403);
    res.end('Forbidden');
    return true;
  }
  try {
    if (existsSync(filePath) && statSync(filePath).isFile()) {
      sendFile(res, filePath);
      return true;
    }
  } catch {
    /* fall through to SPA */
  }
  // SPA fallback
  if (existsSync(indexPath) && statSync(indexPath).isFile()) {
    sendFile(res, indexPath);
    return true;
  }
  res.writeHead(404);
  res.end('Not found');
  return true;
}

type SessionEntry = {
  session: TutorSession;
  card: ProblemCard;
  cardName: string;
  cases?: CaseSpec[];
  persisted: PersistedSession;
};

const sessions = new Map<string, SessionEntry>();

/** Student-safe vocab snapshot — locked term text never leaves the server. */
function vocabFor(entry: SessionEntry): { lockedCount: number; earned: string[] } {
  const locked = new Set(entry.session.lockedTerms);
  return {
    lockedCount: locked.size,
    earned: entry.card.leak_terms.filter((t) => !locked.has(t)),
  };
}

/** Per-session in-flight stress generation — concurrent clicks share one promise. */
const stressInflight = new Map<
  string,
  Promise<{ count: number; stress: { input: string; output: string }[] }>
>();

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
  const { models } = await loadSettings();
  const session = new TutorSession(
    card,
    { teacher: models.teacher, gate: models.gate, unlock: models.unlock },
    {
      tracer: sessionTracer(sessionId),
    },
  );
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
    takes: [],
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
    const { models } = await loadSettings();
    const session = new TutorSession(
      card,
      { teacher: models.teacher, gate: models.gate, unlock: models.unlock },
      {
        restore: persisted.engine,
        tracer: sessionTracer(id),
      },
    );
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

async function ensureCases(entry: SessionEntry): Promise<CaseSpec[]> {
  if (entry.cases) return entry.cases;
  const judge = entry.card.judge;
  const official = await extractCases(entry.card.examples, { stress: false, judge });
  const stressRows = entry.card.stress ?? [];
  const stress =
    stressRows.length > 0
      ? await extractCases(stressRows, { stress: true, judge })
      : [];
  entry.cases = [...official, ...stress];
  return entry.cases;
}

function officialAllPass(result: StudentRunResult): boolean {
  if (result.error) return false;
  const official = result.cases.filter((c) => !c.stress);
  return official.length > 0 && official.every((c) => c.pass);
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
      difficulty?: string;
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
        ...(card.difficulty ? { difficulty: card.difficulty } : {}),
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
      rows.map(({ name, title, difficulty, status, sessions: sess }) => ({
        name,
        title,
        ...(difficulty ? { difficulty } : {}),
        status,
        sessions: sess,
      })),
    );
    return;
  }

  if (method === 'GET' && pathname === '/api/lsp/info') {
    const lang = url.searchParams.get('lang') ?? 'csharp';
    sendJson(res, 200, lspInfo(lang));
    return;
  }

  if (method === 'GET' && pathname === '/api/settings') {
    const settings = await loadSettings();
    sendJson(res, 200, { models: settings.models, backends: ['codex', 'claude'] });
    return;
  }

  if (method === 'PUT' && pathname === '/api/settings') {
    const body = (await readJsonBody(req)) as { models?: AppSettings['models'] };
    if (!body.models) {
      sendJson(res, 400, { error: 'models is required' });
      return;
    }
    try {
      await saveSettings({ models: body.models });
      res.writeHead(204, CORS);
      res.end();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 400, { error: message });
    }
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
        vocab: vocabFor(entry),
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
      takes: entry.persisted.takes,
      solved: entry.persisted.solved,
      vocab: vocabFor(entry),
    });
    return;
  }

  const takeMatch = pathname.match(/^\/api\/session\/([^/]+)\/take$/);
  if (method === 'POST' && takeMatch) {
    const sessionId = takeMatch[1]!;
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
    const newest = entry.persisted.takes[entry.persisted.takes.length - 1];
    if (newest && newest.code === body.code && newest.lang === body.lang) {
      sendJson(res, 200, { takes: entry.persisted.takes });
      return;
    }
    entry.persisted.takes = appendTake(entry.persisted.takes, {
      code: body.code,
      lang: body.lang,
      results: null,
    });
    await persistEntry(entry);
    sendJson(res, 200, { takes: entry.persisted.takes });
    return;
  }

  const stressMatch = pathname.match(/^\/api\/session\/([^/]+)\/stress$/);
  if (method === 'POST' && stressMatch) {
    const sessionId = stressMatch[1]!;
    const entry = await getOrRestore(sessionId);
    if (!entry) {
      sendJson(res, 404, { error: 'session not found' });
      return;
    }
    if (!entry.card.stress || entry.card.stress.length === 0) {
      const loaded = await loadCard(entry.cardName);
      if (loaded.stress && loaded.stress.length > 0) {
        entry.card.stress = loaded.stress;
        delete entry.cases;
      }
    }
    const cached = entry.card.stress;
    if (cached && cached.length > 0) {
      sendJson(res, 200, { count: cached.length, stress: cached });
      return;
    }

    let pending = stressInflight.get(sessionId);
    if (!pending) {
      pending = (async () => {
        try {
          const settings = await loadSettings();
          const ingest = settings.models.ingest;
          const rows = await generateStressCases(
            createClient(ingest.backend),
            entry.card,
            ingest.model,
          );
          entry.card.stress = rows;
          await saveCard(entry.cardName, entry.card);
          delete entry.cases;
          for (const [id, sibling] of sessions) {
            if (id === sessionId) continue;
            if (sibling.cardName !== entry.cardName) continue;
            sibling.card.stress = rows;
            delete sibling.cases;
          }
          return { count: rows.length, stress: rows };
        } finally {
          stressInflight.delete(sessionId);
        }
      })();
      stressInflight.set(sessionId, pending);
    }

    try {
      const result = await pending;
      sendJson(res, 200, result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { error: message });
    }
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
    const body = (await readJsonBody(req)) as {
      code?: string;
      language?: string;
      dirty?: { code: string; lang: string };
    };
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
      const result = await runStudentCode(
        code,
        language as 'python' | 'typescript' | 'javascript' | 'csharp',
        cases,
        scaffold,
        entry.card.judge,
      );
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
      sendJson(res, 200, { result, takes: entry.persisted.takes });
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
      const { cwd: teacherCwd, ext } = await materializeTeacherEditor(
        sessionId,
        entry.persisted.code,
        entry.persisted.lang,
      );
      const boardContext = renderBoardContext(entry.persisted, ext);
      const result = await entry.session.submit(
        message,
        (stage) => sendEvent(res, 'stage', { stage }),
        { cwd: teacherCwd, boardContext },
      );
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
        gesture: result.gesture,
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

  if (tryServeStatic(req, res, pathname)) return;

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

async function boot(): Promise<void> {
  await seedCardsIfNeeded();
  await sweepTeacherScratch();

  server.listen(PORT, () => {
    const addr = server.address();
    const actualPort =
      typeof addr === 'object' && addr !== null ? addr.port : PORT;
    console.log(`TUTOR_READY {"port":${actualPort}}`);
    void pruneEmptySessions()
      .catch((err) => console.warn('prune failed', err))
      .finally(() => {
        console.log(`tutor server on http://localhost:${actualPort}`);
      });
  });
}

boot().catch((err: unknown) => {
  console.error('boot failed', err);
  process.exit(1);
});