# Increment: C# IntelliSense — slim LSP client + csharp-ls WebSocket bridge

## Why / shape
Monaco gives real IntelliSense for TS/JS via its bundled worker; C# gets only
word-based completion. Fix: run `csharp-ls` (Roslyn LSP, already installed
globally, v0.20.0 — verified working) behind a WebSocket bridge on the api
server, and speak LSP to it from the web app with a SLIM hand-rolled client.

**Deliberate architecture decisions (do not revisit):**
- NO `monaco-languageclient` / `@codingame/monaco-vscode-api`. We hand-roll a
  ~300-line client: WebSocket JSON-RPC + four Monaco provider registrations.
  The current `@monaco-editor/react` setup stays exactly as is.
- NO AI/Copilot-style autocomplete of any kind — this product leads students to
  answers; completing their solution would defeat it. Only LSP-backed
  completions/hover/signature-help/diagnostics.
- The server package takes its FIRST dependency: `ws`. That's sanctioned
  (Node has no built-in WebSocket server; hand-rolling RFC 6455 is worse).

## Verified facts from a live csharp-ls smoke test (build on these)
- Spawn `csharp-ls` (no args) with `cwd` = workspace dir; it auto-discovers the
  `.csproj` there. First completions arrive ~4s after didOpen. Do NOT pass
  `--solution`.
- stdio framing is standard LSP: `Content-Length: N\r\n\r\n` + JSON body.
- It sends server→client REQUESTS (`workspace/configuration`,
  `client/registerCapability`). If they get no reply it can wedge — the web
  client must reply `{ result: null }` to any request it doesn't handle.
- Diagnostics arrive as `textDocument/publishDiagnostics` notifications.
- stderr is chatty — it MUST be drained (unread pipes deadlock at ~64KB; see
  commit dc06fb3 for the war story) but doesn't need to go anywhere (discard or
  pipe to nothing).
- Only the first workspaceFolder is loaded; that's fine, we send one.
- Working csproj (verified — completions + hover live against it):
  ```xml
  <Project Sdk="Microsoft.NET.Sdk">
    <PropertyGroup>
      <TargetFramework>net9.0</TargetFramework>
      <OutputType>Library</OutputType>
      <ImplicitUsings>enable</ImplicitUsings>
      <Nullable>disable</Nullable>
    </PropertyGroup>
  </Project>
  ```

## Files to change

### 1. `server/package.json`
Add dependency `ws` (and `@types/ws` as devDependency). Run the install.

### 2. NEW `server/src/lsp.ts`
- `ensureLspWorkspace(): { root, csFile, rootUri, fileUri }` — creates
  `server/.lsp-scratch/` containing `scratch.csproj` (exact content above) and
  an empty `Solution.cs` (placeholder on disk; real content flows via LSP
  overlay). Use `pathToFileURL` for the URIs.
- `attachLspBridge(server: http.Server): void` —
  - `new WebSocketServer({ noServer: true })`; handle the http server's
    `upgrade` event; only accept `pathname === '/lsp/csharp'`, destroy other
    upgrade sockets.
  - Per connection: spawn `csharp-ls` with `cwd` = workspace root.
    - ws message (string) → write one stdio frame to child stdin.
    - child stdout → de-frame (buffer across chunks; a chunk can hold partial
      or multiple frames) → `ws.send(json)` per message.
    - Drain child stderr (discard).
    - ws close → kill child. Child exit/spawn-error → `ws.close(1011,
      'csharp-ls unavailable')`.
  - Single-user app: at most ONE live bridge — a new connection kills the
    previous connection's child and closes its socket first.
- `lspInfo()` → `{ rootUri, fileUri }` for the route below.

### 3. `server/src/server.ts`
- `GET /api/lsp/info` → 200 JSON `{ rootUri, fileUri }`.
- After `http.createServer(...)`: `attachLspBridge(server)`.
- Touch nothing else (the SSE submit endpoint especially).

### 4. `web/vite.config.ts`
`'/lsp': { target: 'http://localhost:8787', ws: true }` alongside the existing
`/api` proxy.

### 5. NEW `web/src/lsp/jsonrpc.ts`
Tiny JSON-RPC-over-WebSocket endpoint:
- `request(method, params): Promise<result>` (incrementing ids; reject on
  `error` in response or socket close),
- `notify(method, params)`,
- `onNotification(method, handler)`,
- unhandled server→client requests get `{ jsonrpc, id, result: null }` replies,
- `dispose()` closes the socket and rejects pending requests.

### 6. NEW `web/src/lsp/csharpLsp.ts`
`startCsharpLsp(monaco: Monaco, editor: ICodeStandaloneEditor): Promise<{ dispose(): void }>`
(use the actual types from `@monaco-editor/react`'s `OnMount` params):
- `fetch('/api/lsp/info')` → uris. WebSocket to
  `` `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/lsp/csharp` ``
  (goes through the vite proxy).
- LSP lifecycle: `initialize` (rootUri, workspaceFolders, minimal
  textDocument capabilities incl. `publishDiagnostics`), `initialized`,
  `textDocument/didOpen` with `{ uri: fileUri, languageId: 'csharp',
  version: 1, text: model.getValue() }`.
- Buffer sync: `model.onDidChangeContent` → debounce 250ms →
  `textDocument/didChange` with FULL text (`contentChanges: [{ text }]`) and an
  incrementing version. Full sync only — no incremental ranges.
- Register with `monaco.languages.*` for language `'csharp'`:
  - **CompletionItemProvider** (`triggerCharacters: ['.']`): map LSP
    `CompletionItem` → Monaco: label, kind (map LSP CompletionItemKind 1-25 →
    `monaco.languages.CompletionItemKind`, default `Text`), insertText
    (`insertText ?? label`; if `textEdit` present use its newText + range),
    documentation (string or MarkupContent.value), detail. Default range: word
    at position. Handle both `CompletionItem[]` and `CompletionList` results.
  - **HoverProvider**: MarkupContent/string/array → `{ contents: [{ value }] }`
    (+ range when the server gives one).
  - **SignatureHelpProvider** (`signatureHelpTriggerCharacters: ['(', ',']`):
    map signatures/parameters/active indices; return the Monaco
    `SignatureHelpResult` shape (`{ value, dispose }`).
  - **Diagnostics**: `onNotification('textDocument/publishDiagnostics')` →
    `monaco.editor.setModelMarkers(model, 'csharp-ls', ...)`; severity map
    1→Error 2→Warning 3→Info 4→Hint; clear markers on dispose.
- Position conversion helpers: LSP is 0-based line/char; Monaco is 1-based
  lineNumber/column. Convert BOTH directions; off-by-ones here are the classic
  bug, be careful.
- `dispose()`: unregister all providers (keep the IDisposables), clear markers,
  cancel the debounce timer, `didClose` best-effort, close the socket.
- Failure = graceful degradation: if the fetch, socket, or initialize fails
  (csharp-ls missing, server down), `console.warn` once and return a no-op
  dispose. The editor must keep working exactly as today (word completion).

### 7. `web/src/CodeEditor.tsx`
- In `onMount`, and whenever `language` changes: if language is `'csharp'`,
  start the LSP session; when it stops being csharp (or on unmount), dispose.
  One session at a time; use a ref. The component's props/API must not change.
- The existing theme/options setup stays byte-identical.

### 8. `.gitignore` (repo root)
Add `server/.lsp-scratch/`.

## What NOT to do
- No new deps beyond `ws`/`@types/ws` (server). ZERO new web deps.
- Don't touch engine/, the SSE submit flow, App.tsx, or the tutor pipeline.
- No AI autocomplete, no `monaco-languageclient`.
- Don't write the student's buffer to disk on every change — sync is via LSP
  didChange only.

## Verify before you report back
- `npx tsc --noEmit` passes in `server`; `npx tsc --noEmit -p tsconfig.app.json`
  passes in `web`.
- Node-only bridge check (no browser needed): a small throwaway script that
  connects a WebSocket to the bridge, runs initialize/didOpen, and gets a
  non-empty completion result for `Console.` — port the logic from
  `.agent-tasks/` sibling knowledge: spawn the server on a scratch port (e.g.
  `PORT=8890 npx tsx src/server.ts`), run the check, kill the server. Include
  the script's output in your report.
- Do NOT start the real dev stack or drive a browser — the supervisor does
  live verification after review.

## Report back
Files changed, commands run, the bridge-check output, and residual risk. Note
anything in the spec that didn't match reality.
