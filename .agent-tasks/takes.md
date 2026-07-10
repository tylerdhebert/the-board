# Increment: takes — run snapshots with checkout, plus the editor finally fills the window

## Why / shape
Two things that solve each other:
1. On tall/fullscreen windows the editor is a fixed 320px with a dead band
   below — it should flex to fill.
2. The user wants run history: every run snapshots `{code, lang, results}` as
   a **take**; chips under the editor toggle between takes; clicking a take is
   a FULL CHECKOUT (restores code+lang+results); dirty work is auto-snapshotted
   as a result-less take before any checkout, so nothing is ever lost.

Vocabulary: they're called **takes** in the UI (chalk voice: `take 2 · 2/3`).

## SUBAGENT GROUND RULES (non-negotiable)
- Test fixtures use ISOLATED paths — never the real `tutor.db` / `logs/`
  (use `TUTOR_DB_PATH` if present in sessionStore; otherwise add it).
- Never kill processes by name — only PIDs you started.
- A desktop stack may be running on 8787/5173/9223 — don't touch it; scratch
  ports only for anything you start, and kill YOUR processes when done.
- NOTE: this lands on top of the polish-pack + provider-settings increments —
  read the current code, not your memory of it.

## Data model

### 1. `server/src/sessionStore.ts`
- New table:
  ```sql
  CREATE TABLE IF NOT EXISTS takes (
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    ts TEXT NOT NULL,
    lang TEXT NOT NULL,
    code TEXT NOT NULL,
    results TEXT,              -- StudentRunResult JSON, NULL for unrun takes
    PRIMARY KEY (session_id, seq)
  );
  ```
- `PersistedSession` gains `takes: PersistedTake[]` where
  `PersistedTake = { seq: number; ts: string; lang: string; code: string; results: StudentRunResult | null }`.
  save/load/list handle the new table exactly like notes (wholesale replace in
  the same transaction; ordered by seq). `lastRun` column: keep writing it
  (newest results) but the API stops reading it — takes are the source of
  truth.
- `isEmptySession` predicate gains `&& takes.length === 0`.

## Server

### 2. `server/src/server.ts`
- Run route becomes take-aware. Body: `{ code, language, dirty?: { code: string; lang: string } }`:
  - If `dirty` is present (client checked out while dirty and immediately ran —
    rare, see web logic; usually dirty snapshots happen client-side via the
    same endpoint), append it as a result-less take first.
  - Execute as today. Then: if the newest take has `results === null` AND its
    `code === code && lang === language`, attach the results to it; otherwise
    append a new take `{ code, lang: language, results }`.
  - Response: `{ result: StudentRunResult, takes: PersistedTake[] }` (full
    list — client state stays dumb).
- NEW `POST /api/session/:id/take` body `{ code, lang }` → appends a
  result-less take (the auto-snapshot on checkout), 200 with `{ takes }`.
  Dedupe: if the newest take has identical code+lang, don't append (return
  current list).
- `GET /api/session/:id` (resume) returns `takes` instead of `lastRun`.
- Solved logic unchanged (all-pass run result).
- Keep persisting code/lang on run as today.

## Web

### 3. `web/src/api.ts`
Types + `runExamples` returns `{ result, takes }`; `addTake(id, code, lang)`;
resume payload carries `takes`.

### 4. `web/src/App.tsx`
- State: `takes: PersistedTake[]`, `selectedTake: number | null` (seq).
  Newest selected after every run/checkout/resume. Replace the old
  `run: StudentRunResult | null` state — the displayed results are ALWAYS the
  selected take's results.
- **Dirty** = current buffer/lang differ from the selected take's code/lang
  (when takes exist; with no takes yet, never dirty). Run button label gains
  ` *` when dirty (title: 'changes since your last take').
- **Run**: as today, then replace `takes` from the response, select newest.
- **Checkout** (chip click, not the selected one): if dirty → `await addTake(id,
  buffer, lang)` first (replaces takes list). Then set code/lang from the
  clicked take, set selected, show its results (or the unrun state).
- **Resume**: use `takes` from payload; select newest; buffer prefers persisted
  code as today (persisted code may be dirtier than the newest take — that's
  correct, and it will read as dirty).
- **reviewPrompt**: feed it the newest take WITH results (not the selected
  one).
- Takes rail UI (replaces `.runresults` position, keeps its case-row rendering
  for the selected take):
  - `.takes-rail`: one row of chips: `take N · x/y` (pass/total), `–/y` when
    results null (y = case count of any run take, or `–/–` if unknown), `✓`
    styling when all pass (sky), coral tint when some fail, chalk-faint for
    unrun. Selected chip: chalk-bright underline (match `.langpick` idiom).
    Horizontal scroll if many (overflow-x auto, no wrap).
  - Below: selected take's case rows exactly like today's `.runresults` (or
    `no results yet — run the examples` line for unrun takes, chalk-faint).
  - The rail block has a FIXED max height (~180px, cases area scrolls) — it
    sits under the editor without pushing layout around.

### 5. Layout: editor fills the window (index.css + CodeEditor.tsx)
- `.desk` → flex column (keep its padding/overflow-y for SHORT windows via
  min-heights below).
- `.problem` keeps natural height. `.workarea` → `flex: 1 1 auto; min-height: 0;
  display: flex; flex-direction: column;`.
- `.editor-shell` → `flex: 1 1 auto; min-height: 334px;` (320 + padding);
  `.monaco-host` → `height: 100%; min-height: 320px;`.
- `CodeEditor.tsx`: `height="100%"` and add `automaticLayout: true` to options
  so Monaco tracks container resize (maximize/restore included).
- The takes rail sits after `.editor-shell` in `.workarea` (natural height, the
  max-height cap above).
- The hero/ledger and loading states must be unaffected (they don't render
  `.workarea`).

## What NOT to do
- No new deps. Don't touch prompts, LSP, SSE, settings panel, ledger.
- Don't add take deletion/naming — chips are enough.
- Don't diff takes — checkout is whole-buffer.

## Verify before you report back (headless + tsc; layout verified by supervisor)
- tsc engine/server/web clean.
- Scratch server + scratch DB script:
  1. create session; POST run (correct python two_sum) → response `takes`
     length 1 with results 3/3.
  2. POST /take with different code → takes length 2, newest results null;
     POST /take again with SAME code → still length 2 (dedupe).
  3. POST run with code matching that unrun take → takes length 2, newest now
     HAS results (filled, not appended).
  4. POST run with brand-new code → length 3.
  5. GET session → `takes` present, ordered; restart scratch server → same.
- git status: only intended files.

## Report back
Files changed, commands run + outputs (the 5-step take-semantics matrix
especially), and residual risk. Note anything that didn't match reality.
