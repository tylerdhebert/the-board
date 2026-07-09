type JsonRpcId = number | string;

type JsonRpcRequest = {
  jsonrpc: '2.0';
  id: JsonRpcId;
  method: string;
  params?: unknown;
};

type JsonRpcNotification = {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
};

type JsonRpcResponse = {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

type Pending = {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
};

export class JsonRpcWs {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<JsonRpcId, Pending>();
  private notificationHandlers = new Map<string, Set<(params: unknown) => void>>();
  private closed = false;

  constructor(ws: WebSocket) {
    this.ws = ws;
    this.ws.addEventListener('message', (ev) => this.onMessage(String(ev.data)));
    this.ws.addEventListener('close', () => this.failAll(new Error('WebSocket closed')));
    this.ws.addEventListener('error', () => this.failAll(new Error('WebSocket error')));
  }

  static connect(url: string): Promise<JsonRpcWs> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const onOpen = () => {
        cleanup();
        resolve(new JsonRpcWs(ws));
      };
      const onError = () => {
        cleanup();
        reject(new Error('WebSocket connection failed'));
      };
      const cleanup = () => {
        ws.removeEventListener('open', onOpen);
        ws.removeEventListener('error', onError);
      };
      ws.addEventListener('open', onOpen);
      ws.addEventListener('error', onError);
    });
  }

  request(method: string, params?: unknown): Promise<unknown> {
    if (this.closed || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('WebSocket not open'));
    }
    const id = this.nextId++;
    const msg: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(msg));
    });
  }

  notify(method: string, params?: unknown): void {
    if (this.closed || this.ws.readyState !== WebSocket.OPEN) return;
    const msg: JsonRpcNotification = { jsonrpc: '2.0', method, params };
    this.ws.send(JSON.stringify(msg));
  }

  onNotification(method: string, handler: (params: unknown) => void): () => void {
    let set = this.notificationHandlers.get(method);
    if (!set) {
      set = new Set();
      this.notificationHandlers.set(method, set);
    }
    set.add(handler);
    return () => {
      set!.delete(handler);
    };
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.failAll(new Error('disposed'));
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }

  private failAll(reason: unknown): void {
    for (const [, p] of this.pending) {
      p.reject(reason);
    }
    this.pending.clear();
  }

  private onMessage(raw: string): void {
    let msg: JsonRpcResponse & Partial<JsonRpcRequest>;
    try {
      msg = JSON.parse(raw) as JsonRpcResponse & Partial<JsonRpcRequest>;
    } catch {
      return;
    }

    // Server → client request: reply with null result if unhandled
    if (msg.method != null && msg.id != null && !('result' in msg) && !('error' in msg)) {
      this.ws.send(
        JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: null } satisfies JsonRpcResponse),
      );
      return;
    }

    // Notification (no id)
    if (msg.method != null && msg.id == null) {
      const handlers = this.notificationHandlers.get(msg.method);
      if (handlers) {
        for (const h of handlers) h(msg.params);
      }
      return;
    }

    // Response
    if (msg.id != null) {
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      this.pending.delete(msg.id);
      if (msg.error) {
        pending.reject(msg.error);
      } else {
        pending.resolve(msg.result);
      }
    }
  }
}
