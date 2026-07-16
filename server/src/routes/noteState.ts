import type http from 'node:http';
import { getOrRestore, persistEntry } from './context.js';
import { CORS, readJsonBody, sendJson } from './http.js';

const MAX_BLANKS = 32;
const MAX_BLANK_LENGTH = 500;

export async function handleNoteState(method: string, pathname: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
  const match = pathname.match(/^\/api\/session\/([^/]+)\/note\/([^/]+)$/);
  if (method !== 'PATCH' || !match) return false;
  const sessionId = match[1]!;
  const seq = Number(match[2]);
  if (!Number.isInteger(seq) || seq < 0) { sendJson(res, 400, { error: 'note seq is invalid' }); return true; }
  const entry = await getOrRestore(sessionId);
  if (!entry) { sendJson(res, 404, { error: 'session not found' }); return true; }
  const body = await readJsonBody(req);
  if (body == null || typeof body !== 'object' || Array.isArray(body)) { sendJson(res, 400, { error: 'note state is required' }); return true; }
  const state = body as Record<string, unknown>;
  const hasBlanks = Object.hasOwn(state, 'blanks');
  const hasSentBack = Object.hasOwn(state, 'sentBack');
  if (!hasBlanks && !hasSentBack) { sendJson(res, 400, { error: 'blanks or sentBack is required' }); return true; }
  const blanks = state.blanks;
  if (hasBlanks && (!Array.isArray(blanks) || blanks.length > MAX_BLANKS || blanks.some((blank) => typeof blank !== 'string' || blank.length > MAX_BLANK_LENGTH))) {
    sendJson(res, 400, { error: 'blanks must be an array of up to 32 strings of 500 characters' }); return true;
  }
  if (hasSentBack && typeof state.sentBack !== 'boolean') { sendJson(res, 400, { error: 'sentBack must be a boolean' }); return true; }
  const note = entry.persisted.notes[seq];
  if (!note || note.role !== 'tutor') { sendJson(res, 400, { error: 'note must be an existing tutor note' }); return true; }
  if (hasBlanks) note.blanks = blanks as string[];
  if (hasSentBack) note.sentBack = state.sentBack as boolean;
  await persistEntry(entry);
  res.writeHead(204, CORS); res.end(); return true;
}
