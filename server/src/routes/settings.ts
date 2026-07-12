import type http from 'node:http';
import { loadSettings, saveSettings, type AppSettings } from '../settings.js';
import { CORS, readJsonBody, sendJson } from './http.js';

export async function handleSettings(
  method: string,
  pathname: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<boolean> {
  if (method === 'GET' && pathname === '/api/settings') {
    const settings = await loadSettings();
    sendJson(res, 200, { models: settings.models, backends: ['codex', 'claude'] });
    return true;
  }

  if (method === 'PUT' && pathname === '/api/settings') {
    const body = (await readJsonBody(req)) as { models?: AppSettings['models'] };
    if (!body.models) {
      sendJson(res, 400, { error: 'models is required' });
      return true;
    }
    try {
      await saveSettings({ models: body.models });
      res.writeHead(204, CORS);
      res.end();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 400, { error: message });
    }
    return true;
  }

  return false;
}
