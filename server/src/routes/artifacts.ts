import { createReadStream, existsSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type http from 'node:http';
import { appPaths } from '../appPaths.js';
import { getOrRestore } from './context.js';

const paths = appPaths();
const SESSION_ID_RE = /^[a-zA-Z0-9-]+$/;
const FILE_RE = /^\d+-[a-z0-9]+(?:-[a-z0-9]+)*\.html$/;

function validPart(value: string, pattern: RegExp): boolean {
  try {
    return pattern.test(decodeURIComponent(value));
  } catch {
    return false;
  }
}

function artifactFileName(seq: number, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'walkthrough';
  return `${seq}-${slug}.html`;
}

export async function storeArtifact(
  sessionId: string,
  seq: number,
  artifact: { title: string; html: string },
): Promise<{ title: string; file: string; url: string }> {
  const file = artifactFileName(seq, artifact.title);
  const dir = path.join(paths.artifactsDir, sessionId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, file), artifact.html, 'utf8');
  return {
    title: artifact.title,
    file,
    url: `/api/artifacts/${encodeURIComponent(sessionId)}/${encodeURIComponent(file)}`,
  };
}

export async function handleArtifact(
  method: string,
  pathname: string,
  res: http.ServerResponse,
): Promise<boolean> {
  const match = pathname.match(/^\/api\/artifacts\/([^/]+)\/([^/]+)$/);
  if (method !== 'GET' || !match) return false;
  const sessionId = match[1]!;
  const file = match[2]!;
  if (!validPart(sessionId, SESSION_ID_RE) || !validPart(file, FILE_RE)) {
    res.writeHead(404);
    res.end('Not found');
    return true;
  }
  const entry = await getOrRestore(sessionId);
  const stored = entry?.persisted.notes.some((note) => note.artifact?.file === file);
  const filePath = path.join(paths.artifactsDir, sessionId, file);
  if (!stored || !existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found');
    return true;
  }
  try {
    if (!statSync(filePath).isFile()) throw new Error('not a file');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
  return true;
}

export function isValidArtifactPart(value: string, kind: 'session' | 'file'): boolean {
  return validPart(value, kind === 'session' ? SESSION_ID_RE : FILE_RE);
}
