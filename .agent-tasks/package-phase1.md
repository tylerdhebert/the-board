# Packaging Phase 1 — data-dir consolidation, static serving, dynamic port

First of three packaging increments (decisions agreed with the user
2026-07-11; see HANDOFF CURRENT STATE). Phase 1 keeps DEV BEHAVIOR
BYTE-FOR-BYTE IDENTICAL when no new env vars are set — that is the
acceptance bar. Files: `server/src/appPaths.ts` (new),
`server/src/engine.ts`, `server/src/sessionStore.ts` (only if the db
default lives there), `server/src/server.ts`, `server/src/lsp.ts`,
`server/src/teacherScratch.ts`, `engine/src/runStudentCode.ts`,
`engine/src/trace.ts` (only if the logs dir default lives there).

## 1. `server/src/appPaths.ts` — one module owns every location

```ts
export type AppPaths = {
  dataDir: string | null;   // TUTOR_DATA_DIR or null (repo layout)
  dbPath: string;           // TUTOR_DB_PATH > dataDir/tutor.db > <repo>/tutor.db
  cardsDir: string;         // dataDir/cards > <repo>/cards
  logsDir: string;          // dataDir/logs > <repo>/logs
  scratchDir: string;       // TUTOR_SCRATCH_DIR > dataDir/scratch > <repo>/server
  teacherScratchDir: string;// TUTOR_TEACHER_SCRATCH_DIR > scratchDir/.teacher-scratch
  runScratchDir: string;    // scratchDir/.run-scratch
  lspScratchDir: string;    // scratchDir/.lsp-scratch   (+ '-py' sibling derived where used)
  webDistDir: string | null;// TUTOR_WEB_DIST > null (null = no static serving)
  seedCardsDir: string | null; // TUTOR_SEED_CARDS > null
}
export function appPaths(): AppPaths
```

Resolution rules: explicit env always wins; `TUTOR_DATA_DIR` shifts the
whole family; with neither, every default is EXACTLY the path used today
(check each current constant and reproduce it — repo cards/, repo logs/,
server/.teacher-scratch, server/.run-scratch, server/.lsp-scratch,
repo tutor.db). Create directories lazily where today's code does; do not
add eager mkdirs beyond what exists.

Rewire consumers to import from appPaths (server/src/engine.ts cardsDir,
sessionStore db default, teacherScratch scratchRoot, lsp.ts scratch roots,
runStudentCode CSHARP_SCRATCH, the JSONL trace logs dir). The ENGINE
package must not import server code — for engine files
(runStudentCode.ts, trace.ts) add optional env overrides
(`TUTOR_RUN_SCRATCH_DIR`, `TUTOR_LOGS_DIR`) falling back to today's
constants, and have the SERVER set those env vars at startup from
appPaths (process.env assignment before first use, in server.ts near the
top). Keep it dumb and explicit.

## 2. Seed cards + boot hygiene (server/src/server.ts startup)

- If `seedCardsDir` is set and `cardsDir` does not exist or is empty:
  copy `*.card.json` + `*.snippets.json` from seed to cardsDir (fs.cp).
- Teacher-scratch sweep: on boot, list teacherScratchDir subdirs; delete
  any whose name is not a session id present in the db (listSessions).
  Wrap in try/catch — sweep failure must never block boot.

## 3. Static serving (server/src/server.ts)

When `webDistDir` is non-null: any GET not starting with `/api` or `/lsp`
serves from webDistDir — path-traversal-safe join (reject paths escaping
the root after resolve), correct Content-Type for html/js/css/svg/png/
woff2/json/ico/map, and SPA fallback: if the file does not exist, serve
`index.html`. API/upgrade routing takes precedence and is untouched when
webDistDir is null (dev mode: vite serves the client, exactly as now).

## 4. Dynamic port + ready line (server/src/server.ts)

- Support `PORT=0` (OS-assigned). After `listen`, read the actual port
  from `server.address()`.
- Print exactly one machine-readable line to stdout on readiness:
  `TUTOR_READY {"port":<actualPort>}` — IN ADDITION to the existing
  human line (keep it, with the actual port). The Electron main will
  parse this in Phase 2.

## Do NOT

- No Electron/desktop changes (Phase 2).
- No behavior change when none of the new env vars are set — same paths,
  same logs, same everything. The existing TUTOR_DB_PATH and
  TUTOR_TEACHER_SCRATCH_DIR overrides must keep working unchanged.
- No new dependencies.

## Verify

- `npx tsc --noEmit` clean in engine/ and server/.
- Prove dev-identical: start the server with no new env on a scratch
  TUTOR_DB_PATH and hit /api/problems (works as today).
- Prove the new mode: `TUTOR_DATA_DIR=<temp> TUTOR_SEED_CARDS=<repo>/cards
  TUTOR_WEB_DIST=<repo>/web/dist PORT=0` → stdout has TUTOR_READY with a
  real port; GET / returns index.html; GET /api/problems lists the seeded
  cards; a session db appears under the temp dataDir. Include the
  commands + output in your report. Kill the server after.

## Report back

Files changed, commands run + outputs, residual risk.
