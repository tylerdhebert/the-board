# desktop debugging

Canonical workflow for agents that need to run, inspect, debug, and visually verify The Board in the Electron shell.

## start

```bash
npm run desktop
```

This starts the API (`:8787`), Vite (`:5173`), then the frameless Electron window loading the Vite URL. Browser mode (`npm run dev` + a tab) still works the same way.

Chromium DevTools Protocol listens on **9223** by default (effortless uses 9222). Override with `TUTOR_CDP_PORT`.

Open detached DevTools at launch with `TUTOR_OPEN_DEVTOOLS=1`. In a running window, **Ctrl+Shift+D** toggles DevTools.

## attach

CDP base URL:

```text
http://127.0.0.1:9223
```

Pick the `page` target whose URL contains `localhost:5173` (not a `devtools://` target). The renderer exposes the desktop bridge as `window.tutorDesktop`.

Guard before relying on desktop APIs:

```js
Boolean(window.tutorDesktop)
```

Useful calls:

```js
await window.tutorDesktop.isMaximized()
await window.tutorDesktop.captureShot({ name: 'before.png', outDir: 'strip' })
```

## screenshots / eval

Prefer Electron-native captures (real BrowserWindow chrome + content):

```bash
node scripts/shot.mjs capture --name before.png
node scripts/shot.mjs capture --out-dir strip --name after.png
node scripts/shot.mjs eval "Boolean(window.tutorDesktop)"
```

`capture` calls `window.tutorDesktop.captureShot(...)` over CDP and prints:

```text
<path>  <sha256>
```

If the bridge is missing, it falls back to CDP `Page.captureScreenshot` and still writes under `.shots/` with the same path + hash line.

Artifacts land under `.shots/<mm-dd>/` (optionally `…/<out-dir>/`). The folder is gitignored.

## visual verification loop

1. Start `npm run desktop`.
2. Confirm `Boolean(window.tutorDesktop)` is true.
3. Capture a baseline with `node scripts/shot.mjs capture --name before.png`.
4. Make the UI change.
5. Vite hot-reloads **web** changes. Restart desktop when **main** or **preload** changed.
6. Drive the affected UI path.
7. Capture again; compare SHA-256 hashes and inspect the PNGs.
8. Report the artifact paths used for verification.

## troubleshooting

- No CDP target: wait for the window to finish loading, or restart `npm run desktop`.
- `window.tutorDesktop` missing: you are on a browser tab, not the Electron renderer — use the desktop shell.
- Unchanged screenshots: confirm the UI state actually changed, then compare hashes.
- Clicks ignored in the strip: anything interactive inside the drag region must be `-webkit-app-region: no-drag`.
