# Increment: polish pack — ledger hygiene, honest run failures, tracing, window state, sticky LSP

Five small independent fixes. No new dependencies anywhere.

## SUBAGENT GROUND RULES (non-negotiable, learned the hard way)
- Test fixtures must use ISOLATED paths (a temp dir, a scratch DB path passed
  via env or copied file) — NEVER the real `tutor.db`, `sessions*`, `logs/`,
  or `.shots/` of this repo.
- NEVER kill processes broadly (no name-based Get-Process|Stop-Process, no
  killing all node/electron). Kill only PIDs you started, by PID.
- A desktop stack may be running on 8787/5173/9223 — leave it alone; use
  scratch ports for any server you start, and kill YOUR server when done.

## 1. Ledger hygiene (server + web)
- `GET /api/problems`: exclude "empty" sessions from the response — a session
  with `engine.turnCounter === 0 && !solved && code === ''`. (Keep them in the
  DB; they're just noise, not data. If their exclusion leaves a problem with
  zero sessions, its status is computed as if it had none.)
- Boot prune: in server startup (after the store is first touched), delete
  sessions matching the same emptiness predicate whose `updatedAt` is older
  than 24h. Add `deleteSessions(ids: string[])` to sessionStore (transactional;
  notes cascade). Log `pruned N empty session(s)` only when N > 0.
- Session snippet: `/api/problems` session refs gain `first: string` — the
  first student note's text, truncated to 80 chars ('' when none). Web: the
  ledger session row shows it after the meta, chalk-faint, single line,
  ellipsis overflow (CSS).

## 2. Honest run failure for missing/void returns (engine or web — engine preferred)
In `toRunResult` (engine/src/runStudentCode.ts): when a case has no error,
`got` is null/undefined, and `expected` is NOT null: instead of
`pass: false` with `got: 'null'`, set the case error to
`got nothing back — did you return the result? (in-place/mutation problems aren't supported yet)`.
The web already renders per-case `error` text; no web change needed.

## 3. Wire the tracer (server)
- `server/src/server.ts`: construct EVERY TutorSession (newEntry AND
  getOrRestore) with `{ tracer: new JsonlTracer(path.join(repoRoot, 'logs', `${sessionId}.jsonl`)) }`
  (mkdir `logs/` on boot; `logs/` is already gitignored). Re-export
  JsonlTracer through server/src/engine.ts.
- Note: JsonlTracer appends per turn — a resumed session appends to the same
  file. That's desired.

## 4. Desktop window state (desktop/main.mjs)
- Persist `{ x, y, width, height, maximized }` to
  `desktop/.window-state.json` (add to .gitignore) on `resize`/`move`
  (debounced ~500ms, only when not maximized) and on `maximize`/`unmaximize`.
- On createWindow: load the file; apply width/height/x/y when present and the
  position is on a visible display (`screen.getDisplayMatching` sanity check —
  fall back to defaults when the saved bounds are off-screen); call
  `win.maximize()` after creation when saved maximized.
- Corrupt/missing file → defaults, silently.

## 5. Sticky C# LSP across language switches (web)
Currently `CodeEditor.tsx` disposes the LSP session when `language` leaves
'csharp' — switching csharp → typescript → csharp pays the ~5s project load
again. Change to:
- Start the session lazily on FIRST entry to csharp; keep it alive across
  subsequent language switches; dispose only on unmount.
- While `language !== 'csharp'` the session must go dormant:
  - suppress didChange sends (the buffer is TS/JS text — pushing it would make
    Roslyn diagnose garbage),
  - clear the model markers (`setModelMarkers(model, 'csharp-ls', [])`) on
    leaving csharp, and ignore incoming publishDiagnostics while dormant.
  - (Providers are registered for language 'csharp' only, so completions/hover
    are already inert on other languages.)
- On re-entry to csharp: push one full didChange immediately (version++), then
  resume normal debounced sync.
Implement inside `csharpLsp.ts` with a `setActive(active: boolean)` on the
returned handle (plus dispose), and drive it from CodeEditor's language
effect. The generation-counter race guard in CodeEditor stays.

## Verify before you report back (headless; scratch ports; isolated fixtures)
- tsc: engine, server, web — all clean.
- 1: seed a SCRATCH DB (env-var or copy — do NOT touch tutor.db; if the store
  path isn't overridable, add `TUTOR_DB_PATH` env support to sessionStore as
  part of this change and use it) with: an empty session (0 turns, no code,
  25h old), an empty RECENT session (1h old), and a real session (1 turn,
  code, snippet-able first note). Boot scratch server → prune log says 1;
  /api/problems: excludes the remaining empty recent one from sessions, real
  one has `first` populated.
- 2: run a TS solution that never returns (e.g. `function twoSum(){ }` shaped
  for the case args) via runStudentCode directly → per-case error contains
  'did you return'.
- 3: one REAL submit turn on the scratch server → `logs/<id>.jsonl` exists
  with one line containing `finalVerdict` and `calls`.
- 4: `--smoke` still passes. Window-state logic: assert the module
  reads/writes the json (a tiny node --eval against exported helpers is fine,
  or factor the load/save into pure functions and test those).
- 5: typecheck + code review only (live LSP verification is the supervisor's).
Kill your scratch server; leave the repo's real DB/logs untouched (git status
must show only intended file changes).

## Report back
Files changed, commands run + outputs, and residual risk. Note anything in
the spec that didn't match reality.
