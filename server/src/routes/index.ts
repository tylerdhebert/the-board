import http from 'node:http';
import { URL } from 'node:url';
import { handleEditor } from './editor.js';
import { handleLspInfo } from './lsp.js';
import { handleProblems } from './problems.js';
import { handleRun } from './runs.js';
import { handleCreateSession } from './sessions.js';
import type { SessionRouteDeps } from './sessions.js';
import { handleSettings } from './settings.js';
import { tryServeStatic } from './static.js';
import { handleStress } from './stress.js';
import { handleSubmit } from './submit.js';
import { handleArtifact } from './artifacts.js';
import { CORS, sendJson } from './http.js';

export async function handle(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: SessionRouteDeps = {},
): Promise<void> {
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const pathname = url.pathname;

  if (method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  if (await handleProblems(method, pathname, res)) return;
  if (await handleLspInfo(method, pathname, url, res)) return;
  if (await handleSettings(method, pathname, req, res)) return;
  if (await handleCreateSession(method, pathname, req, res, deps)) return;
  if (await handleEditor(method, pathname, req, res)) return;
  if (await handleStress(method, pathname, res)) return;
  if (await handleRun(method, pathname, req, res)) return;
  if (await handleSubmit(method, pathname, req, res)) return;
  if (await handleArtifact(method, pathname, res)) return;

  if (tryServeStatic(req, res, pathname)) return;

  sendJson(res, 404, { error: 'not found' });
}

export function createRequestHandler(deps: SessionRouteDeps = {}): (
  req: http.IncomingMessage,
  res: http.ServerResponse,
) => void {
  return (req, res) => {
    handle(req, res, deps).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) {
        sendJson(res, 500, { error: message });
      } else {
        res.end();
      }
    });
  };
}
