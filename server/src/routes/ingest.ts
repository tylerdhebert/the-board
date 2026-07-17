import { randomUUID } from 'node:crypto';
import type http from 'node:http';
import { isLlmCanceledError } from '../../../engine/src/llm.js';
import { broadcastAppEvent } from '../appEvents.js';
import { createClient, getOrIngestCard, toSlug } from '../engine.js';
import { loadSettings } from '../settings.js';
import { readJsonBody, sendJson } from './http.js';

export type IngestJobStatus = 'running' | 'done' | 'error' | 'canceled';

export type IngestJob = {
  id: string;
  query: string;
  normalizedQuery: string;
  status: IngestJobStatus;
  startedAt: string;
  title?: string;
  cardName?: string;
  error?: string;
  controller: AbortController;
};

export type IngestRouteDeps = {
  getOrIngestCard?: typeof getOrIngestCard;
  loadSettings?: typeof loadSettings;
};

const jobs = new Map<string, IngestJob>();
const MAX_RETAINED_JOBS = 50;

// Dedupe on the resolved card slug, not the raw text — "two sum" and its
// LeetCode URL are the same card, and two concurrent jobs would race the same
// cache files with duplicate LLM ingests. Fall back to normalized text when
// the query doesn't resolve to a slug.
function dedupeKey(query: string): string {
  const normalized = query.trim().replace(/\s+/g, ' ').toLowerCase();
  try {
    return toSlug(query) || normalized;
  } catch {
    return normalized;
  }
}

function publicJob(job: IngestJob) {
  return {
    id: job.id,
    query: job.query,
    status: job.status,
    ...(job.title ? { title: job.title } : {}),
    ...(job.cardName ? { cardName: job.cardName } : {}),
    ...(job.error ? { error: job.error } : {}),
    startedAt: job.startedAt,
  };
}

function shortError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/\s+/g, ' ').trim().slice(0, 280) || 'ingest failed';
}

function pruneJobs(): void {
  const finished = [...jobs.values()]
    .filter((job) => job.status !== 'running')
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  for (const job of finished.slice(MAX_RETAINED_JOBS)) jobs.delete(job.id);
}

async function runJob(job: IngestJob, deps: IngestRouteDeps): Promise<void> {
  try {
    const settings = await (deps.loadSettings ?? loadSettings)();
    if (job.status !== 'running') return;
    const ingest = settings.models.ingest;
    const result = await (deps.getOrIngestCard ?? getOrIngestCard)(job.query, {
      client: createClient(ingest.backend),
      model: ingest.model,
      signal: job.controller.signal,
    });
    if (job.status !== 'running') return;
    job.status = 'done';
    job.title = result.card.title;
    job.cardName = toSlug(job.query);
    broadcastAppEvent({
      type: 'ingest:done',
      jobId: job.id,
      query: job.query,
      cardName: job.cardName,
      title: job.title,
    });
  } catch (err) {
    if (job.status !== 'running') return;
    if (job.controller.signal.aborted || isLlmCanceledError(err)) {
      job.status = 'canceled';
      broadcastAppEvent({ type: 'ingest:canceled', jobId: job.id, query: job.query });
    } else {
      job.status = 'error';
      job.error = shortError(err);
      broadcastAppEvent({ type: 'ingest:error', jobId: job.id, query: job.query, error: job.error });
    }
  } finally {
    pruneJobs();
  }
}

function startJob(query: string, deps: IngestRouteDeps): IngestJob {
  const key = dedupeKey(query);
  const existing = [...jobs.values()].find(
    (job) => job.status === 'running' && job.normalizedQuery === key,
  );
  if (existing) return existing;

  const job: IngestJob = {
    id: randomUUID(), query: query.trim(), normalizedQuery: key, status: 'running',
    startedAt: new Date().toISOString(), controller: new AbortController(),
  };
  jobs.set(job.id, job);
  broadcastAppEvent({ type: 'ingest:started', jobId: job.id, query: job.query });
  void runJob(job, deps);
  return job;
}

export async function handleIngest(
  method: string, pathname: string, req: http.IncomingMessage, res: http.ServerResponse,
  deps: IngestRouteDeps = {},
): Promise<boolean> {
  if (method === 'POST' && pathname === '/api/ingest') {
    const body = (await readJsonBody(req)) as { query?: string };
    if (typeof body.query !== 'string' || !body.query.trim()) {
      sendJson(res, 400, { error: 'query is required' });
      return true;
    }
    const job = startJob(body.query, deps);
    sendJson(res, 202, { jobId: job.id, query: job.query });
    return true;
  }

  if (method === 'GET' && pathname === '/api/ingest') {
    sendJson(res, 200, [...jobs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).map(publicJob));
    return true;
  }

  const match = /^\/api\/ingest\/([^/]+)$/.exec(pathname);
  if (method === 'DELETE' && match) {
    const job = jobs.get(match[1]!);
    if (!job) {
      sendJson(res, 404, { error: 'ingest job not found' });
      return true;
    }
    if (job.status === 'running') {
      job.status = 'canceled';
      job.controller.abort();
      broadcastAppEvent({ type: 'ingest:canceled', jobId: job.id, query: job.query });
    }
    sendJson(res, 200, publicJob(job));
    return true;
  }

  return false;
}
