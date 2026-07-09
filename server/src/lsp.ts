import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';

const CSPROJ = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net9.0</TargetFramework>
    <OutputType>Library</OutputType>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>disable</Nullable>
  </PropertyGroup>
</Project>
`;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '.lsp-scratch');
const CS_FILE = path.join(ROOT, 'Solution.cs');
const CSPROJ_FILE = path.join(ROOT, 'scratch.csproj');

let workspaceReady = false;

export function ensureLspWorkspace(): {
  root: string;
  csFile: string;
  rootUri: string;
  fileUri: string;
} {
  if (!workspaceReady) {
    fs.mkdirSync(ROOT, { recursive: true });
    fs.writeFileSync(CSPROJ_FILE, CSPROJ, 'utf8');
    if (!fs.existsSync(CS_FILE)) {
      fs.writeFileSync(CS_FILE, '', 'utf8');
    }
    workspaceReady = true;
  }
  return {
    root: ROOT,
    csFile: CS_FILE,
    rootUri: pathToFileURL(ROOT + path.sep).href,
    fileUri: pathToFileURL(CS_FILE).href,
  };
}

export function lspInfo(): { rootUri: string; fileUri: string } {
  const { rootUri, fileUri } = ensureLspWorkspace();
  return { rootUri, fileUri };
}

function encodeFrame(json: string): Buffer {
  const header = `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n`;
  return Buffer.concat([Buffer.from(header, 'utf8'), Buffer.from(json, 'utf8')]);
}

class StdioFramer {
  private buffer = Buffer.alloc(0);

  push(chunk: Buffer): string[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const messages: string[] = [];
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) break;
      const header = this.buffer.subarray(0, headerEnd).toString('utf8');
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        // Drop garbage until next potential header
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + length) break;
      const body = this.buffer.subarray(bodyStart, bodyStart + length).toString('utf8');
      this.buffer = this.buffer.subarray(bodyStart + length);
      messages.push(body);
    }
    return messages;
  }
}

type LiveBridge = {
  ws: WebSocket;
  child: ChildProcessWithoutNullStreams;
};

let live: LiveBridge | null = null;

function killLive(): void {
  if (!live) return;
  const prev = live;
  live = null;
  try {
    prev.child.kill();
  } catch {
    /* ignore */
  }
  try {
    prev.ws.close();
  } catch {
    /* ignore */
  }
}

function attachConnection(ws: WebSocket): void {
  killLive();

  const { root } = ensureLspWorkspace();
  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn('csharp-ls', [], {
      cwd: root,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
  } catch (err) {
    console.warn('csharp-ls spawn failed', err);
    ws.close(1011, 'csharp-ls unavailable');
    return;
  }

  live = { ws, child };
  const framer = new StdioFramer();

  child.stderr.on('data', () => {
    /* drain — discard */
  });

  child.stdout.on('data', (chunk: Buffer) => {
    for (const msg of framer.push(chunk)) {
      if (ws.readyState === ws.OPEN) {
        ws.send(msg);
      }
    }
  });

  const onChildGone = () => {
    if (live?.child === child) {
      live = null;
      if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) {
        ws.close(1011, 'csharp-ls unavailable');
      }
    }
  };
  child.on('error', onChildGone);
  child.on('exit', onChildGone);

  ws.on('message', (data) => {
    const json = typeof data === 'string' ? data : data.toString('utf8');
    try {
      child.stdin.write(encodeFrame(json));
    } catch {
      /* child may already be dead */
    }
  });

  ws.on('close', () => {
    if (live?.ws === ws) {
      live = null;
      try {
        child.kill();
      } catch {
        /* ignore */
      }
    }
  });
}

export function attachLspBridge(server: http.Server): void {
  ensureLspWorkspace();
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const host = req.headers.host ?? 'localhost';
    const { pathname } = new URL(req.url ?? '/', `http://${host}`);
    if (pathname !== '/lsp/csharp') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      attachConnection(ws);
    });
  });
}
