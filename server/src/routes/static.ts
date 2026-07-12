import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import type http from 'node:http';
import { appPaths } from '../appPaths.js';

const paths = appPaths();

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

export function tryServeStatic(
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
