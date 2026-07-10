# Increment: Python LSP (pyright) over the generalized bridge

The language picker already offers python; give it real IntelliSense like
csharp has. Same slim-client architecture — no monaco-languageclient, ever.

## SUBAGENT GROUND RULES (non-negotiable)
- Test fixtures use ISOLATED paths (`TUTOR_DB_PATH`, scratch dirs) — never
  the real `tutor.db` / `logs/` / `cards/` / the real LSP scratch dirs.
- Never kill processes by name — only PIDs you started.
- A desktop stack may be running on 8787/5173/9223 — untouched; scratch ports
  only for anything you start, killed by PID when done.

## 1. `server/package.json`
Add dependency `pyright` (npm; ships the language server). Run the install.

## 2. `server/src/lsp.ts` — generalize
- Config table:
  ```ts
  const LSP_LANGS = {
    csharp: { scratch: '.lsp-scratch', file: 'Solution.cs',
              setup: <writes csproj + empty Solution.cs exactly as today>,
              spawn: (cwd) => spawn('csharp-ls', [], { cwd }) },
    python: { scratch: '.lsp-scratch-py', file: 'solution.py',
              setup: <writes empty solution.py + pyrightconfig.json {"typeCheckingMode":"basic"}>,
              spawn: (cwd) => spawn(process.execPath,
                [<abs path to server/node_modules/pyright/langserver.index.js>, '--stdio'],
                { cwd }) },
  }
  ```
  (node + the package's `langserver.index.js` entry — the .bin shim is a .cmd
  on Windows; node+js avoids shell quirks.)
- Upgrade path `/lsp/csharp` AND `/lsp/python` (destroy others). ONE live
  bridge PER LANGUAGE — a new connection for a language kills only that
  language's previous bridge.
- `lspInfo(lang)` per language; route `GET /api/lsp/info?lang=csharp|python`
  (missing lang defaults to csharp).
- `.gitignore`: add `server/.lsp-scratch-py/`.

## 3. Web — generalize the client
- Refactor `csharpLsp.ts` internals into `startLsp(monaco, editor, cfg)` with
  cfg = `{ lang, languageId, wsPath, monacoLanguage }`; export thin
  per-language starters (keep exported names/types tight).
  - Providers registered per monaco language ('csharp' / 'python');
    completion trigger `['.']` for both.
  - Keep the didOpen-empty → $/progress-end → didChange flow, but python's
    fallback timer is 1.5s (pyright needs no project load).
  - pyright sends `window/workDoneProgress/create` server→client REQUESTS —
    JsonRpcWs's null-reply should cover it; VERIFY, don't assume.
- `CodeEditor.tsx`: one handle PER LANGUAGE (`Map<lang, Handle>`): entering
  csharp or python lazily starts that language's session; `setActive(true)`
  on the current language and `false` on the other; dispose all on unmount.
  The generation-counter guard stays.
- csharp behavior must be byte-identical from the user's view.

## What NOT to do
- No changes to run flow, prompts, settings, session logic.
- Don't share scratch dirs between language servers.
- No new web deps.

## Verify before you report back (headless)
- tsc engine/server/web clean.
- Scratch server + node bridge check for PYTHON (port the csharp
  bridge-check pattern): ws to /lsp/python, initialize, didOpen empty,
  didChange with `import os\nos.`, completion at the dot → non-empty, sample
  labels (expect os members like `path`). Include output.
- Same bridge check for CSHARP still passes (regression). Include output.
- git status: only intended files. Kill your scratch server by PID.

## Report back
Files changed, commands run + outputs (both bridge checks), residual risk,
anything that didn't match reality.
