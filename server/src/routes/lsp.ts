import type http from 'node:http';
import { lspInfo } from '../lsp.js';
import { sendJson } from './http.js';

export async function handleLspInfo(
  method: string,
  pathname: string,
  url: URL,
  res: http.ServerResponse,
): Promise<boolean> {
  if (method !== 'GET' || pathname !== '/api/lsp/info') return false;

  const lang = url.searchParams.get('lang') ?? 'csharp';
  sendJson(res, 200, lspInfo(lang));
  return true;
}
