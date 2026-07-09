# Increment: Electron shell — frameless window, chalk titlebar, AI-debug tooling

## Why / shape
The app was always meant to be an Electron app (recorded in HANDOFF roadmap
item 3). This increment is the shell: a frameless desktop window whose
titlebar IS the existing header strip (custom min/max/close controls, chalk
styling), plus the AI-screenshot/debug tooling this project's sibling
(effortless) proved out: a CDP port, a renderer bridge, a capture script that
takes Electron-native screenshots and prints path + SHA-256.

Dev-mode shell ONLY for now: electron loads the vite dev server and the api
runs as today. No packaging/installer (electron-builder is a later increment).
Browser mode (`npm run dev` + a tab) must keep working identically.

## Architecture facts (already decided — build on these)
- New `desktop/` package: `{ "name": "desktop", "private": true, "type": "module" }`
  with devDependency `electron` (^43). Its own `npm install`; add it to the
  root `setup` script chain.
- Electron 43 supports ESM main. Preload MUST be CommonJS → name it
  `preload.cjs`.
- `npm run desktop` at root → `node dev.mjs --desktop`. dev.mjs already has
  proven tree-kill child management (taskkill /T /F on Windows) — extend it,
  don't rewrite it.
- Node here is v25: `scripts/shot.mjs` can use the global `WebSocket` client —
  ZERO new dependencies for the CDP driver.
- CDP port: default **9223** (9222 is effortless's), override `TUTOR_CDP_PORT`.

## Files

### 1. NEW `desktop/package.json` + install
As above. Run the install so `desktop/node_modules/.bin/electron` exists.

### 2. NEW `desktop/main.mjs` (electron main)
- `app.commandLine.appendSwitch('remote-debugging-port', process.env.TUTOR_CDP_PORT ?? '9223')`
  BEFORE app ready.
- `--smoke` flag: on ready, print `smoke ok` and `app.quit()` without creating
  a window (used for verification).
- BrowserWindow: `frame: false`, `backgroundColor: '#16241d'`, 1600×1000,
  `minWidth/minHeight` something sane (1100×700), webPreferences:
  `{ preload: <abs path to preload.cjs>, contextIsolation: true, nodeIntegration: false }`.
- Loads `process.env.TUTOR_WEB_URL ?? 'http://localhost:5173'`.
- IPC (ipcMain.handle / .on):
  - `win:minimize`, `win:close`
  - `win:toggle-maximize` (maximize ⇄ unmaximize)
  - push `win:maximized-changed` (boolean) to the renderer on the window's
    `maximize`/`unmaximize` events, and answer `win:is-maximized`.
  - `debug:capture` `{ name?, outDir? }` → `webContents.capturePage()` → PNG
    written to `<repoRoot>/.shots/<mm-dd>/<outDir?>/<name ?? shot-HHmmss.png>`
    (mkdir -p), returns `{ path, sha256 }` (node:crypto).
- Dev conveniences (copy the effortless pattern): `before-input-event` →
  Ctrl+Shift+D toggles devtools; `TUTOR_OPEN_DEVTOOLS=1` opens detached
  devtools at start.
- `window-all-closed` → `app.quit()` (also on darwin — single-window app).

### 3. NEW `desktop/preload.cjs`
`contextBridge.exposeInMainWorld('tutorDesktop', {`
- `minimize()`, `toggleMaximize()`, `close()` → ipcRenderer.send/invoke
- `isMaximized(): Promise<boolean>`
- `onMaximizedChanged(cb: (max: boolean) => void): () => void` (returns
  unsubscribe; wrap ipcRenderer.on/removeListener)
- `captureShot(opts?: { name?: string; outDir?: string }): Promise<{ path, sha256 }>`
`})`

### 4. `dev.mjs` — `--desktop` mode
When `process.argv` includes `--desktop`: after starting api + web exactly as
today, poll `http://localhost:${WEB_PORT}` until it answers (simple fetch loop,
~250ms interval, 30s cap), then `start('desktop', …)` the electron child:
command `desktop/node_modules/.bin/electron` (`.cmd` shim caveat on Windows —
`start()` already uses `shell: isWin`, so invoking the bin path works; pass
`main.mjs` path), env `TUTOR_WEB_URL`. The existing exit/tree-kill logic must
apply to it like the others (closing the window tears down api+web; Ctrl+C
tears down all three).
Root `package.json`: add `"desktop": "node dev.mjs --desktop"` script; extend
`setup` with `npm install --prefix desktop`.

### 5. Web: titlebar = the existing strip
- NEW `web/src/WindowControls.tsx`: renders nothing when
  `window.tutorDesktop` is absent. Otherwise three buttons at the strip's far
  right: minimize `—`, maximize `□` / restore `❐` (tracks
  `onMaximizedChanged` + initial `isMaximized()`), close `×`. Space Mono
  glyphs, `.winctl` class, chalk-dim default → chalk on hover; close hover =
  coral. Buttons are ~44px wide hit targets, height = strip height.
- `App.tsx`: render `<WindowControls />` as the last child of `.strip`; add
  `in-desktop` class to the `.board` div when `window.tutorDesktop` exists
  (plain conditional, no state — the bridge exists before React runs).
- A `web/src/tutorDesktop.d.ts` (or inline types) declaring `window.tutorDesktop`.
- CSS (index.css):
  ```css
  .in-desktop .strip { -webkit-app-region: drag; }
  .in-desktop .strip input,
  .in-desktop .strip button { -webkit-app-region: no-drag; }
  ```
  plus `.winctl` styles. IMPORTANT (learned in effortless): everything
  clickable inside a drag region MUST be no-drag or it silently eats clicks.

### 6. NEW `scripts/shot.mjs` — the AI screenshot/eval driver (zero-dep)
CDP client against `http://127.0.0.1:${TUTOR_CDP_PORT ?? 9223}`:
- fetch `/json`, pick the `page` target whose url contains `localhost:5173`
  (NOT devtools targets), connect its `webSocketDebuggerUrl` with global
  `WebSocket`, speak CDP (incrementing ids).
- Subcommands:
  - `capture [--name x.png] [--out-dir slug]` — Runtime.evaluate
    `window.tutorDesktop.captureShot({...})` with `awaitPromise: true`
    (returnByValue) → print `path  sha256`. If the bridge is missing, fall
    back to CDP `Page.captureScreenshot` and write the PNG to the same
    `.shots/<mm-dd>/` layout itself, still printing path + sha256.
  - `eval "<js>"` — Runtime.evaluate with awaitPromise+returnByValue, print
    JSON result; on `exceptionDetails`, print the exception text and exit 1.
- Exit non-zero with a readable message when no CDP target is up.

### 7. NEW `docs/desktop-debugging.md`
Short canonical doc modeled on effortless's electron-ui-debugging.md: how to
start (`npm run desktop`), CDP port 9223, the `window.tutorDesktop` guard,
capture/eval script usage, artifact root `.shots/` (gitignored), the
visual-verification loop, and the rule that web changes hot-reload but
main/preload changes need a desktop restart.

### 8. `.gitignore`: add `.shots/`

## What NOT to do
- No packaging/electron-builder/auto-update.
- No changes to server/, engine/, the LSP bridge, or the tutor pipeline.
- Don't replace the header strip's contents or styling beyond adding the
  controls + drag CSS; the chalk look stays.
- No new web/server deps; desktop's only dep is electron.
- Do NOT set `titleBarStyle`/`titleBarOverlay` — plain `frame: false` with our
  own controls.

## Verify before you report back (no GUI launches)
- `npx tsc --noEmit -p tsconfig.app.json` in `web` — pass.
- `desktop/node_modules/.bin/electron desktop/main.mjs --smoke` prints
  `smoke ok` and exits 0 (this is why --smoke exists; it must not create a
  window or load a URL).
- `node scripts/shot.mjs eval "1+1"` against nothing → readable "no CDP
  target" error, non-zero exit (proves the error path).
- Do NOT run `npm run desktop`, do NOT start api/vite (a live stack is
  already running on 8787/5173 and the supervisor verifies the full flow).

## Report back
Files changed, commands run + outputs, and residual risk. Note anything in
the spec that didn't match reality.
