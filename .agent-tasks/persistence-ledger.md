# Increment: persistence + the ledger — sessions survive restarts, problems show state

## Why / shape
Sessions live in an in-memory Map: restart the app and every tutoring
conversation is gone, and there's no sense of progression. This adds:
1. **Write-through session persistence** (one JSON file per session in a
   gitignored `sessions/` dir — file-per-thing, matching `cards/`; no DB, no
   new deps) with transparent rehydration: a request against a session id the
   server doesn't have in memory restores it from disk.
2. **The ledger**: the hero pane becomes a browsable problem roster with
   status (`new` / `attempted` / `solved`), expandable per-problem session
   history, and **resume** — full transcript, editor code, language, and last
   run results restored.

Answer-key rule unchanged: persisted files may contain the engine transcript
(that's text the student already saw) but NEVER card internals; the resume
endpoint returns only student-safe fields exactly like /api/session does.

## Engine

### 1. `engine/src/session.ts`
- Add `get turn(): number` (returns turnCounter).
- Constructor opts gain `restore?: { transcript: Message[]; lockedTerms: string[]; turnCounter: number }`
  — when present, seed `_transcript` (copy), `_lockedTerms` (copy, replacing
  the card-derived default), and `turnCounter`. Everything else unchanged.
No other engine changes.

## Server

### 2. NEW `server/src/sessionStore.ts`
`sessions/` at repo root (mkdir on demand). One file per session:
`sessions/<id>.json`:
```ts
export type PersistedNote = {
  role: 'student' | 'tutor'
  text: string
  mode?: string
  unlocked?: string[]
  redrafted?: boolean
}
export type PersistedSession = {
  id: string
  cardName: string
  title: string
  startedAt: string      // ISO
  updatedAt: string
  solved: boolean
  lang: string           // last known editor language ('' until client reports)
  code: string           // last known editor buffer
  notes: PersistedNote[] // what the margin showed (display text, not raw prompts)
  lastRun: StudentRunResult | null
  engine: { transcript: Message[]; lockedTerms: string[]; turnCounter: number }
}
```
Functions: `saveSession(s)` (ATOMIC: write `<id>.json.tmp` then rename over),
`loadSession(id)` (null when missing/unparseable), `listSessions()` (readdir
`*.json`, parse each, skip corrupt files silently). No caching layer — this is
a single-user local app; readdir is fine.

### 3. `server/src/server.ts`
- `SessionEntry` gains `persisted: PersistedSession`. Central helpers:
  - `newEntry(card, cardName)` → constructs TutorSession + a fresh
    PersistedSession (id = the sessionId), saves it, puts in the Map.
  - `getOrRestore(id): Promise<SessionEntry | null>` — Map hit, else
    `loadSession(id)` → `loadCard(cardName)` → `new TutorSession(card, DEFAULT_MODELS,
    { restore: persisted.engine })` → into the Map. Null when neither exists.
  - `persistEntry(entry)` — refresh `persisted.engine` from the live session
    (`transcript`, `lockedTerms`, `turn`), bump updatedAt, saveSession.
- **/api/session and /api/start**: use `newEntry`; response unchanged.
- **submit route**: use `getOrRestore`. Body gains optional `display?: string`
  (what the margin shows for the student note — the review button sends
  '↳ review my work' while `message` is the full prompt). After a successful
  turn: push the student note (`display ?? message`) and the tutor note
  (reply + mode/unlockedThisTurn/redrafted) onto `persisted.notes`, then
  `persistEntry`. SSE protocol on the wire unchanged apart from reading the
  extra body field.
- **run route**: use `getOrRestore`. After a run: `persisted.lastRun = result`;
  if `result.cases.length > 0 && result.cases.every(c => c.pass)` set
  `persisted.solved = true`; also store `code`/`language` into
  `persisted.code`/`lang`; `persistEntry`.
- NEW **`PUT /api/session/:id/editor`** body `{ code: string; lang: string }` →
  updates persisted code/lang, saves, 204. (Client debounces; this is so
  resume gets the buffer even when they never ran/submitted.)
- NEW **`GET /api/session/:id`** → rehydrates via `getOrRestore`, returns
  `{ sessionId, cardName, problem: { ...studentSafeProblem(card), codeSnippets:
  await loadSnippets(cardName) }, notes, code, lang, lastRun, solved }`.
- NEW **`GET /api/problems`** → merge `listCards()` with `listSessions()`
  grouped by cardName:
  ```ts
  [{ name, title, status: 'new'|'attempted'|'solved',
     sessions: [{ id, startedAt, updatedAt, turns, solved }] }]  // turns = engine.turnCounter
  ```
  status = solved if any session solved, else attempted if any session, else
  new. Sessions within a problem sorted by updatedAt desc. Problems sorted:
  ones with sessions by latest updatedAt desc, then new ones alphabetically
  by title. Sessions whose cardName has no card file: skip.
- **DELETE the `GET /api/cards` route** — /api/problems supersedes it (update
  the web client accordingly; clean end state, no legacy endpoint).

### 4. `.gitignore`: add `sessions/`

## Web

### 5. `web/src/api.ts`
- `getProblems(): Promise<ProblemSummary[]>` (types mirroring the endpoint).
- `getSession(id): Promise<ResumePayload>`.
- `saveEditor(id, code, lang): Promise<void>` (fire-and-forget PUT; swallow errors).
- `submitTurn` body gains optional `display` (third-ish param; keep onStage last
  or use an options object — your call, keep it typed).
- Remove `getCards`.

### 6. `web/src/App.tsx` + `index.css`
- Replace the `cards` state with `problems: ProblemSummary[]` from
  `getProblems()`; refresh it after a session is created, after a run
  completes (solved state may have changed), and when returning to the hero.
- **Loader exact-match** now matches against `problems` (title or name,
  case-insensitive) — same behavior as before, then `createSession(name)`.
- **The ledger** (hero pane): when `problems.length > 0`, render under a
  compressed hero (keep the headline + one-line pitch; drop the "try:" line —
  the roster replaces it):
  - eyebrow `the board so far`
  - one row per problem (`.ledger-row`): status mark + title + meta
    (`n sessions · <relative or short date of latest>` for touched ones).
    Status marks: solved `✓` in var(--sky); attempted `~` in var(--amber);
    new `·` in var(--chalk-faint). Mono, chalk voice, lowercase meta.
  - Clicking a row with sessions toggles an expansion (`.ledger-sessions`)
    listing each session: `<short date> · <turns> turns · ✓` (if solved) and a
    `resume` affordance per session, plus a `fresh start` row/button.
    Clicking a `new` problem (or `fresh start`) starts a session directly
    (`createSession(name)` — same flow as the loader).
  - Keep it typographic — no cards/boxes; indentation and chalk marks only.
- **Resume flow**: `resumeSession(id)`: `getSession(id)` → set sessionId,
  problem, notes (map PersistedNote → Note with `revealing: false` — NO
  typewriter replay on restore), code (persisted code if non-empty else
  scaffold for lang), lang (persisted lang if set else current), run
  (lastRun), clear input/error. Editor and margin land exactly where they
  left off.
- **Editor sync**: debounce 2s after `code`/`lang` changes while a session is
  active → `saveEditor`. Don't save when code is empty AND lang unchanged.
  Cancel the timer on unmount/new problem.
- **Review turns**: `turn(reviewPrompt(...), '↳ review my work')` already
  passes displayText — send it as `display` on the wire now.
- CSS: `.ledger`, `.ledger-row`, `.ledger-sessions` etc. following the
  existing chalk/mono/eyebrow patterns (see `.hero .how`, `.problem .eyebrow`).

## What NOT to do
- No database, no new dependencies.
- Don't change prompts, gate/unlock flow, LSP, or the SSE event protocol
  (only the submit request body gains `display`).
- Don't persist anything derived from the answer key beyond the transcript
  the student already saw.
- No delete-session UI this increment.

## Verify before you report back (headless only — no dev servers left running, no browser)
Script it against a scratch server (`PORT=8899 npx tsx src/server.ts`, kill
when done). LLM turns are slow (~25s) — budget for that, run turns only where
stated:
1. POST /api/session (two_sum) → sessions/<id>.json exists with engine state,
   notes [].
2. POST submit with `{message, display: 'shown text'}` (ONE real turn) → file
   now has 2 notes (student note text = 'shown text'), engine.transcript
   length 2, turnCounter 1.
3. PUT editor state → file has code/lang.
4. **Kill the server process. Start a fresh one (same port).**
5. GET /api/session/:id → 200, notes + code + lang intact.
6. POST a run with a correct two_sum python solution → all pass → file has
   solved: true, lastRun populated.
7. GET /api/problems → two_sum status 'solved', session listed with turns: 1;
   an untouched card shows 'new'.
8. POST submit again on the SAME id against the fresh server (ONE real turn) →
   works (rehydrated session), turnCounter now 2 — proves restore feeds the
   tutor its history.
9. `npx tsc --noEmit` in engine + server; `npx tsc --noEmit -p
   tsconfig.app.json` in web.
Kill the scratch server and any leftover children when done.

## Report back
Files changed, commands run + outputs (the 8-step scenario especially), and
residual risk. Note anything in the spec that didn't match reality.
