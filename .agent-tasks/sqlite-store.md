# Increment: SQLite persistence — sessions move to a DB, cross-platform by construction

## Why / shape
Session persistence shipped as JSON-file-per-session (`sessions/`). The user
wants it in SQLite, cross-platform. Decision already made: **`node:sqlite`**
(built into Node ≥22; verified working on this machine's Node 25 —
`new DatabaseSync(path)`). ZERO new dependencies, no native prebuilds, no
ABI concerns on any OS. Do NOT use better-sqlite3 or any npm sqlite package.

Scope: sessions/progression only. **Cards + snippets stay as files** — they're
git-committed content. The ledger/resume/rehydration behavior must be
byte-identical from the client's point of view.

`server/src/sessionStore.ts` was built as the seam: it exports
`saveSession(s)`, `loadSession(id)`, `listSessions()` and the
`PersistedSession`/`PersistedNote` types. Swap its implementation; keep its
exported API EXACTLY as is so `server.ts` needs no changes beyond none at all.

## Files

### 1. `server/src/sessionStore.ts` — reimplement on SQLite
- `import { DatabaseSync } from 'node:sqlite'` (synchronous API — fine, this
  is a single-user local server; wrap in the existing async signatures).
- DB file: `<repoRoot>/tutor.db` (same dirname resolution as now). Open once
  lazily (module-level `let db` + `getDb()`), `pragma journal_mode = WAL`.
- Schema (create if not exists on open):
  ```sql
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    card_name TEXT NOT NULL,
    title TEXT NOT NULL,
    started_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    solved INTEGER NOT NULL DEFAULT 0,
    lang TEXT NOT NULL DEFAULT '',
    code TEXT NOT NULL DEFAULT '',
    last_run TEXT,                -- JSON or NULL
    engine_transcript TEXT NOT NULL,   -- JSON array
    engine_locked_terms TEXT NOT NULL, -- JSON array
    engine_turn_counter INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS notes (
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    role TEXT NOT NULL,
    text TEXT NOT NULL,
    mode TEXT,
    unlocked TEXT,               -- JSON array or NULL
    redrafted INTEGER,
    PRIMARY KEY (session_id, seq)
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_card ON sessions(card_name);
  ```
  `PRAGMA foreign_keys = ON`.
- `saveSession(s)`: upsert the sessions row; replace notes wholesale
  (`DELETE FROM notes WHERE session_id = ?` then insert each with seq = index)
  inside ONE transaction (`db.exec('BEGIN')`/`COMMIT`, `ROLLBACK` on throw).
  Wholesale replace keeps the store dumb and matches current semantics.
- `loadSession(id)` / `listSessions()`: reassemble `PersistedSession` objects
  (JSON.parse the JSON columns, notes ordered by seq). Return null / [] as
  today. Keep the same id sanitization on load (harmless, keep it).
- **One-time migration** inside `getDb()` after schema creation: if
  `<repoRoot>/sessions/` exists and contains `*.json`, import each (skip
  corrupt, skip ids already in the DB), then rename the dir to
  `sessions.migrated/` (leave the files — don't delete user data). Log one
  line: `migrated N session(s) from sessions/ into tutor.db`.

### 2. `.gitignore`
Add `tutor.db`, `tutor.db-wal`, `tutor.db-shm`, `sessions.migrated/` (keep the
existing `sessions/` line).

### 3. `server/tsconfig` types note
If `node:sqlite` types are missing from the installed @types/node, bump
`@types/node` in server (dev-only) rather than `declare module` hacks — check
first; current @types/node is ^22 which HAS node:sqlite types.

## What NOT to do
- No npm sqlite packages, no ORMs, no async wrappers beyond the existing
  function signatures.
- No changes to server.ts, engine/, or web/ — if you find you need one, stop
  and note it in the report instead.
- Cards/snippets stay files. logs/ untouched.
- Don't delete `sessions/` json files — rename dir to `sessions.migrated/`.

## Verify before you report back (headless, scratch server on 8899)
1. With an existing `sessions/*.json` present (create a realistic one by hand
   or from a fresh POST /api/session run BEFORE swapping — easiest: git stash
   your change, create, unstash… or just handcraft a valid PersistedSession
   json): boot the server → migration log line; `sessions.migrated/` exists;
   GET /api/problems shows the migrated session.
2. POST /api/session → row lands in tutor.db (`node -e` with DatabaseSync to
   inspect counts).
3. PUT editor + POST run (correct python two_sum) → solved=1, last_run
   populated in the DB; GET /api/problems shows solved.
4. Kill server, restart → GET /api/session/:id returns notes/code/lang; POST
   a real submit turn on that id (ONE turn) → works, turn counter increments
   in the DB.
5. WAL files appear next to tutor.db; no `sessions/` dir gets recreated.
6. `npx tsc --noEmit` in server (engine/web untouched — confirm with git
   status).
Kill the scratch server when done.

## Report back
Files changed, commands run + outputs, DB inspection output, and residual
risk. Note anything in the spec that didn't match reality.
