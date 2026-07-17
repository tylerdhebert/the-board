import http from 'node:http';
import { once } from 'node:events';
import { createRequestHandler } from '../src/routes/index.js';
import { attachLspBridge } from '../src/lsp.js';
import WebSocket from 'ws';

const server = http.createServer(createRequestHandler({
  loadSettings: async () => ({
    models: {
      teacher: { backend: 'codex', model: 'test' },
      gate: { backend: 'codex', model: 'test' },
      unlock: { backend: 'codex', model: 'test' },
      ingest: { backend: 'codex', model: 'test' },
    },
    backends: ['codex'],
    leetcode: { signedIn: false },
  }),
  getOrIngestCard: async (_query, opts) => await new Promise((_, reject) => {
    opts?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }),
}));
attachLspBridge(server);

try {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing server address');
  const base = `http://127.0.0.1:${address.port}`;
  const events: Array<{ type: string; jobId: string }> = [];
  const ws = new WebSocket(`ws://127.0.0.1:${address.port}/ws/events`);
  ws.on('message', (data) => events.push(JSON.parse(data.toString()) as { type: string; jobId: string }));
  await once(ws, 'open');

  const created = await fetch(`${base}/api/ingest`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'queue probe' }),
  });
  const { jobId } = await created.json() as { jobId: string };
  const running = await (await fetch(`${base}/api/ingest`)).json() as Array<{ id: string; status: string }>;
  if (!running.some((job) => job.id === jobId && job.status === 'running')) throw new Error('job was not running');
  await fetch(`${base}/api/ingest/${jobId}`, { method: 'DELETE' });
  const deadline = Date.now() + 2_000;
  while (!events.some((event) => event.type === 'ingest:canceled' && event.jobId === jobId)) {
    if (Date.now() > deadline) throw new Error('missing ingest:canceled event');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  ws.close();
  console.log('ingest queue verified: running, canceled, and websocket event')
} finally {
  server.close();
}
