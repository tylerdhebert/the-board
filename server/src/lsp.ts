import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { tryHandleAppEventsUpgrade } from './appEvents.js';
import { appPaths } from './appPaths.js';

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
const SERVER_ROOT = path.resolve(__dirname, '..');

function pyrightLangserver(): string {
  if (process.env.TUTOR_PYRIGHT_PATH) {
    return path.resolve(process.env.TUTOR_PYRIGHT_PATH);
  }
  return path.join(SERVER_ROOT, 'node_modules', 'pyright', 'langserver.index.js');
}

type LangId = 'csharp' | 'python';

type LangConfig = {
  file: string;
  setup: (root: string, filePath: string) => void;
  spawn: (cwd: string) => ChildProcessWithoutNullStreams;
};

const LSP_LANGS: Record<LangId, LangConfig> = {
  csharp: {
    file: 'Solution.cs',
    setup: (root, filePath) => {
      fs.writeFileSync(path.join(root, 'scratch.csproj'), CSPROJ, 'utf8');
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, '', 'utf8');
      }
    },
    spawn: (cwd) =>
      spawn('csharp-ls', [], {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      }),
  },
  python: {
    file: 'solution.py',
    setup: (root, filePath) => {
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, '', 'utf8');
      }
      fs.writeFileSync(
        path.join(root, 'pyrightconfig.json'),
        JSON.stringify({ typeCheckingMode: 'basic' }),
        'utf8',
      );
    },
    spawn: (cwd) =>
      spawn(process.execPath, [pyrightLangserver(), '--stdio'], {
        cwd,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      }),
  },
};

function lspScratchRoot(lang: LangId): string {
  const base = appPaths().lspScratchDir;
  return lang === 'python' ? `${base}-py` : base;
}

const ready = new Set<LangId>();

function isLangId(v: string): v is LangId {
  return v === 'csharp' || v === 'python';
}

export function ensureLspWorkspace(lang: LangId): {
  root: string;
  filePath: string;
  rootUri: string;
  fileUri: string;
} {
  const cfg = LSP_LANGS[lang];
  const root = lspScratchRoot(lang);
  const filePath = path.join(root, cfg.file);
  if (!ready.has(lang)) {
    fs.mkdirSync(root, { recursive: true });
    cfg.setup(root, filePath);
    ready.add(lang);
  }
  return {
    root,
    filePath,
    rootUri: pathToFileURL(root + path.sep).href,
    fileUri: pathToFileURL(filePath).href,
  };
}

export function lspInfo(lang: string = 'csharp'): { rootUri: string; fileUri: string } {
  const id: LangId = isLangId(lang) ? lang : 'csharp';
  const { rootUri, fileUri } = ensureLspWorkspace(id);
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

const liveByLang = new Map<LangId, LiveBridge>();

function killLive(lang: LangId): void {
  const prev = liveByLang.get(lang);
  if (!prev) return;
  liveByLang.delete(lang);
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

function attachConnection(ws: WebSocket, lang: LangId): void {
  killLive(lang);

  const cfg = LSP_LANGS[lang];
  const { root } = ensureLspWorkspace(lang);
  let child: ChildProcessWithoutNullStreams;
  try {
    child = cfg.spawn(root);
  } catch (err) {
    console.warn(`${lang} lsp spawn failed`, err);
    ws.close(1011, `${lang} lsp unavailable`);
    return;
  }

  liveByLang.set(lang, { ws, child });
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
    if (liveByLang.get(lang)?.child === child) {
      liveByLang.delete(lang);
      if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) {
        ws.close(1011, `${lang} lsp unavailable`);
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
    if (liveByLang.get(lang)?.ws === ws) {
      liveByLang.delete(lang);
      try {
        child.kill();
      } catch {
        /* ignore */
      }
    }
  });
}

export function attachLspBridge(server: http.Server): void {
  ensureLspWorkspace('csharp');
  ensureLspWorkspace('python');
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const host = req.headers.host ?? 'localhost';
    const { pathname } = new URL(req.url ?? '/', `http://${host}`);
    const match = /^\/lsp\/(csharp|python)$/.exec(pathname);
    if (!match) {
      if (tryHandleAppEventsUpgrade(req, socket, head)) return;
      socket.destroy();
      return;
    }
    const lang = match[1] as LangId;
    wss.handleUpgrade(req, socket, head, (ws) => {
      attachConnection(ws, lang);
    });
  });
}
