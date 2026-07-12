import type http from 'node:http';
import { createClient, generateStressCases, loadCard, saveCard } from '../engine.js';
import { loadSettings } from '../settings.js';
import { getOrRestore, sessions, stressInflight } from './context.js';
import { sendJson } from './http.js';

export async function handleStress(
  method: string,
  pathname: string,
  res: http.ServerResponse,
): Promise<boolean> {
  const stressMatch = pathname.match(/^\/api\/session\/([^/]+)\/stress$/);
  if (method !== 'POST' || !stressMatch) return false;

  const sessionId = stressMatch[1]!;
  const entry = await getOrRestore(sessionId);
  if (!entry) {
    sendJson(res, 404, { error: 'session not found' });
    return true;
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
    return true;
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
  return true;
}
