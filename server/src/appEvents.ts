import type http from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';

export type AppEvent =
  | { type: 'ingest:started'; jobId: string; query: string }
  | { type: 'ingest:done'; jobId: string; query: string; cardName: string; title: string }
  | { type: 'ingest:error'; jobId: string; query: string; error: string }
  | { type: 'ingest:canceled'; jobId: string; query: string };

const eventWss = new WebSocketServer({ noServer: true });

export function tryHandleAppEventsUpgrade(
  req: http.IncomingMessage,
  socket: import('node:stream').Duplex,
  head: Buffer,
): boolean {
  const host = req.headers.host ?? 'localhost';
  const { pathname } = new URL(req.url ?? '/', `http://${host}`);
  if (pathname !== '/ws/events') return false;
  eventWss.handleUpgrade(req, socket, head, (ws) => {
    // An unhandled 'error' event on a ws client throws and kills the process
    // (e.g. a browser dropping the socket uncleanly) — swallow it; 'close'
    // already removes the client from eventWss.clients.
    ws.on('error', () => {});
  });
  return true;
}

export function broadcastAppEvent(event: AppEvent): void {
  const message = JSON.stringify(event);
  for (const client of eventWss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  }
}
