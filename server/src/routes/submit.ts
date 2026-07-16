import type http from 'node:http';
import {
  materializeTeacherEditor,
  renderBoardContext,
} from '../teacherScratch.js';
import { getOrRestore, persistEntry } from './context.js';
import { storeArtifact } from './artifacts.js';
import { CORS, readJsonBody, sendEvent, sendJson } from './http.js';

export async function handleSubmit(
  method: string,
  pathname: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<boolean> {
  const submitMatch = pathname.match(/^\/api\/session\/([^/]+)\/submit$/);
  if (method !== 'POST' || !submitMatch) return false;

  const sessionId = submitMatch[1]!;
  const entry = await getOrRestore(sessionId);
  if (!entry) {
    sendJson(res, 404, { error: 'session not found' });
    return true;
  }
  const body = (await readJsonBody(req)) as { message?: string; display?: string; direct?: boolean };
  const message = body.message;
  if (typeof message !== 'string') {
    sendJson(res, 400, { error: 'message is required' });
    return true;
  }
  const display = typeof body.display === 'string' ? body.display : undefined;
  const direct = body.direct === true;
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
      { cwd: teacherCwd, boardContext, language: entry.persisted.lang },
      { direct },
    );
    entry.persisted.notes.push({
      role: 'student',
      text: display ?? message,
    });
    let storedArtifact: { title: string; file: string; url: string } | undefined;
    if (result.artifact) {
      try {
        storedArtifact = await storeArtifact(
          sessionId,
          entry.persisted.notes.length,
          result.artifact,
        );
      } catch (artifactErr) {
        console.warn('failed to store artifact', sessionId, artifactErr);
      }
    }
    entry.persisted.notes.push({
      role: 'tutor',
      text: result.reply,
      mode: result.mode,
      unlocked: result.unlockedThisTurn,
      redrafted: result.redrafted,
      ...(storedArtifact ? { artifact: { title: storedArtifact.title, file: storedArtifact.file } } : {}),
    });
    // Reply first, persist after — a disk-write failure must never eat a
    // reply the tutor already produced.
    sendEvent(res, 'result', {
      reply: result.reply,
      mode: result.mode,
      unlockedThisTurn: result.unlockedThisTurn,
      redrafted: result.redrafted,
      gesture: result.gesture,
      artifact: storedArtifact,
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
  return true;
}
