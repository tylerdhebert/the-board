# Packaging Phase 2 — server bundle, packaged Electron main, installer

Second packaging increment; requires Phase 1 (appPaths, TUTOR_READY,
static serving) to be in the tree. Produces a real Windows installer +
portable exe via electron-builder. Files: `desktop/package.json`,
`desktop/main.mjs`, `desktop/scripts/build-server.mjs` (new),
`desktop/electron-builder.yml` (new), root `package.json` (scripts),
`.gitignore`, `engine/src/runStudentCode.ts`, `server/src/lsp.ts`,
`web/index.html`, `web/src/index.css`, `web/src/assets/fonts/*` (new).

## 1. Self-hosted fonts (web)

The client loads Bricolage Grotesque / Space Grotesk / Space Mono from
Google's CDN — a packaged app must work offline. Download the woff2 files
(use curl with a modern Chrome User-Agent against
`https://fonts.googleapis.com/css2?...` — the exact URL is in
`web/index.html` — then fetch each `url(...woff2)` it references; latin
subsets are sufficient). Save under `web/src/assets/fonts/`, add
`@font-face` rules at the TOP of `web/src/index.css` (font-display: swap,
correct weight ranges — Bricolage is a variable font, declare
`font-weight: 200 800` on the one variable file if that is what Google
serves), and REMOVE the Google `<link>` tags from `web/index.html`.
Verify `npx vite build` inlines/copies them and the built app renders the
right faces (spot-check dist assets contain the woff2s).

## 2. Packaged TS/JS student runs without tsx (engine/src/runStudentCode.ts)

New env switch `TUTOR_TS_RUNNER=strip`: when set, `runTsJs` spawns
`process.execPath` with args `['--experimental-strip-types', runnerPath]`
and env `{ ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '' }`
instead of the tsx CLI. (Student LeetCode solutions are type-annotation
TS — strip-types covers them; Node ≥22.6 has the flag, Electron 43 ships
Node 24.18. The `.ts` runner file extension stays.) Default (env unset):
tsx path unchanged — dev identical. Suppress the strip-types
ExperimentalWarning noise by adding `--no-warnings` before the flag in
strip mode (harness output parsing reads the LAST stdout line, but keep
stderr clean anyway).

## 3. Pyright path override (server/src/lsp.ts)

`TUTOR_PYRIGHT_PATH` env: absolute path to `langserver.index.js`. When
set, use it; default: today's `server/node_modules/pyright/...` path.
Also spawn pyright with env `{ ...process.env, ELECTRON_RUN_AS_NODE: '1' }`
(harmless under plain node, required when process.execPath is the app exe).

## 4. Server bundle (desktop/scripts/build-server.mjs)

esbuild API script (add `esbuild` as a desktop devDependency):
entry `server/src/server.ts` → `desktop/dist-server/server.cjs`,
`bundle: true, platform: 'node', format: 'cjs', target: 'node24'`,
node builtins external (esbuild handles `node:` automatically),
`external: []` otherwise — ws bundles fine (its optional native deps are
try/require'd; add them to `external` if esbuild errors:
`bufferutil`, `utf-8-validate`). Print the output size.

## 5. Packaged mode in desktop/main.mjs

Branch on `app.isPackaged`:

- DEV (today's path): untouched.
- PACKAGED: `const R = process.resourcesPath`;
  spawn the api: `spawn(process.execPath, [path.join(R, 'server', 'server.cjs')], { env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    PORT: '0',
    TUTOR_DATA_DIR: app.getPath('userData'),
    TUTOR_SCRATCH_DIR: path.join(app.getPath('userData'), 'scratch'),
    TUTOR_WEB_DIST: path.join(R, 'web-dist'),
    TUTOR_SEED_CARDS: path.join(R, 'seed-cards'),
    TUTOR_PYRIGHT_PATH: path.join(R, 'pyright', 'langserver.index.js'),
    TUTOR_TS_RUNNER: 'strip',
  }, stdio: ['ignore', 'pipe', 'pipe'] })` — scan child stdout lines for
  `TUTOR_READY {json}` (30s timeout → dialog.showErrorBox + quit), then
  `win.loadURL('http://127.0.0.1:' + port)`.
- Child lifecycle: kill the api child (tree-kill, same taskkill approach
  the dev launcher uses) on `before-quit` and on window close; if the api
  child exits unexpectedly, showErrorBox with the last 20 stderr lines and
  quit.
- `app.requestSingleInstanceLock()` — second instance focuses the first.
- CDP/debug: the remote-debugging-port and the tutorDesktop capture
  surface only when `process.env.TUTOR_DEBUG === '1'` OR not packaged
  (dev keeps today's behavior exactly).
- Window icon: `icon: path.join(__dirname, 'build', 'icon.png')` on the
  BrowserWindow (harmless in dev too).

## 6. electron-builder (desktop/electron-builder.yml + package.json)

- devDependency `electron-builder`; desktop package.json gets
  `"name": "the-board-desktop", "productName": "The Board"` (keep module
  type as-is), script `"dist": "node scripts/build-server.mjs && electron-builder"`.
- electron-builder.yml:
  - appId `board.the.tutor`, productName `The Board`,
    directories: { output: `release`, buildResources: `build` }
  - files: `main.mjs`, `preload.cjs`, `windowState.mjs`, `build/icon.png`,
    `package.json`
  - extraResources:
    - `dist-server/server.cjs` → `server/server.cjs`
    - `../web/dist` → `web-dist`
    - `../cards` → `seed-cards` (filter: `*.card.json`, `*.snippets.json`)
    - `../server/node_modules/pyright` → `pyright`
  - win: { target: [nsis, portable], icon: `build/icon.ico` }
  - nsis: { oneClick: true, perMachine: false,
    deleteAppDataOnUninstall: false }
  - asar: true is fine (nothing spawns from inside asar — server.cjs,
    pyright, web-dist all live in extraResources, outside the asar).
- Root package.json: script `"dist"`:
  `cd web && npx vite build` then `cd desktop && npm run dist`
  (mind Windows cmd chaining — use `&&`).
- .gitignore: add `desktop/dist-server/` and `desktop/release/`.

## Verify

- tsc clean in engine/ and server/; `vite build` clean.
- `node desktop/scripts/build-server.mjs` produces server.cjs; run it
  directly under plain node with PORT=0 + a scratch TUTOR_DATA_DIR and
  confirm TUTOR_READY + /api/problems works (proves the bundle is
  self-contained).
- Run the full `dist` and confirm `desktop/release/win-unpacked/The Board.exe`
  and the NSIS + portable artifacts exist. Do NOT run the exe or the
  installer — the orchestrator does the live verification.
- Include command outputs in the report.

## Do NOT

- No dev-behavior changes with the new envs unset.
- No auto-update, no code signing.
- Do not run the installer.

## Report back

Files changed, commands run + outputs (esp. artifact paths + sizes),
residual risk.
