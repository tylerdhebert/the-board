# Increment: UI round 1 — ruled slate, attempts rail, run button, reset, difficulty badges

User-directed UI round. Eight items. The design language is sacred: chalk
outlines via the #chalk-rough filter, mono/lowercase chrome, colored-chalk
vocabulary (amber tutor / coral you / sky meta). Read index.css idioms first.

## SUBAGENT GROUND RULES (non-negotiable)
- Test fixtures use ISOLATED paths (`TUTOR_DB_PATH`, scratch logs) — never the
  real `tutor.db` / `logs/` / `cards/` (backfill exception below, carefully).
- Never kill processes by name — only PIDs you started.
- A desktop stack may be running on 8787/5173/9223 — don't touch it; scratch
  ports for anything you start.

## 1. Ruled slate — line numbers continue past the buffer (web)
Monaco only numbers real lines. Add a GHOST margin continuation so the
numbers run to the bottom of the editor like ruled slate:
- In `CodeEditor.tsx` (onMount): an absolutely-positioned div inside the
  editor container, aligned to Monaco's margin column, rendering numbers
  `lineCount+1 … N` from the bottom of the real content to the container
  bottom. Recompute on: content change, container resize (the editor's
  `onDidContentSizeChange` + `onDidLayoutChange`), scroll
  (`onDidScrollChange` — offset the ghost block by content height minus
  scrollTop).
- Match the real margin's metrics: read `editor.getOption` for lineHeight and
  the layoutInfo for margin width; font = same as editor; color =
  `#3a4a41` (editorLineNumber.foreground from the theme) at ~60% opacity so
  ghosts read fainter than real numbers.
- `pointer-events: none`. No interference with Monaco's own margin.
- It must look right when: buffer shorter than viewport (ghosts fill down),
  buffer taller (no ghosts, content scrolls), window resized/maximized.

## 2. Whitespace-insensitive dirty (web)
`normalizeForDirty(code) = code.split('\n').map(l => l.replace(/\s+$/,'')).join('\n').replace(/\n+$/,'')`
— right-trim every line, drop trailing blank lines. INDENTATION STILL COUNTS
(semantic in Python). Use it everywhere dirtiness is decided: the `dirty`
derivation, the auto-snapshot-on-checkout decision, and the reset flow (item
5). Lang inequality is still dirty.

## 3. Attempts rail — vertical, collapsible, renamed (web)
- ALL user-visible copy says **attempt**, never take. Internal names/tables
  stay `takes` (no schema churn).
- Layout: `.workarea` row: `.editor-shell` (flex 1) + `.attempts-rail`
  (~200px column, right of the editor, full editor height, its own
  overflow-y). Each row: `attempt N` left, `x/y` right (`–/y` unrun; sky when
  all pass, coral when some fail, chalk-faint unrun). Selected row: chalk
  underline/bright, same idiom as today's selected chip. `title` attr = the
  attempt's timestamp (locale time).
- Collapsible: a small header row on the rail (`attempts` eyebrow + `‹`/`›`
  glyph). Collapsed = rail shrinks to a thin vertical strip (~28px) showing
  just the glyph (and attempt count, rotated or stacked, your call — keep it
  quiet). Collapse state is plain useState (no persistence).
- Case results for the selected attempt STAY under the editor (today's
  `.takes-cases` rendering, still capped height).
- Checkout/auto-snapshot/dirty semantics unchanged (but now whitespace-aware
  per item 2).

## 4. The run button becomes a chalk play button (web)
Replace the text-underline `.runbtn` with: a compact button = small play
triangle (inline SVG, `fill: none; stroke: var(--amber)`, `filter:
url(#chalk-rough)`, ~14px) + mono lowercase label `run`. Amber text; hover
brightens (like `.review:hover`). Dirty state: label `run *` + existing
title. Running: label `running…`, disabled, triangle stays. Keep it small —
it lives in the worklabel row.

## 5. Reset to scaffold (web)
A small mono text button `reset` next to the langpick (chalk-faint, hover
chalk). Enabled when a session is active and the buffer differs
(whitespace-insensitively) from the current language's scaffold. On click:
if dirty (vs selected attempt, whitespace-aware), auto-snapshot via the
existing `/take` flow first; then set the buffer to `snippetFor(problem,
lang)` and setSeed likewise. No confirmation dialog — the snapshot IS the
safety.

## 6. Languages: only the ones we support end-to-end (web)
`LANGS = ['csharp', 'typescript', 'python', 'javascript']`. Remove java/cpp/
go from the picker (LANG_SLUG entries may stay; harmless). RUNNABLE already
equals this set — the run button now always shows during a session.

## 7. Axe the smudge (web)
Delete the `.smudge` line ("the tutor knows the solution…") from App.tsx and
its CSS. Nothing replaces it.

## 8. Difficulty badges (engine + server + web + backfill)
- `ProblemCard` type gains optional `difficulty?: string` ('Easy' | 'Medium'
  | 'Hard'). `getOrIngestCard` stamps `card.difficulty = problem.difficulty`
  (fetchProblem already returns it) after ingest, before writing the card
  file. Do NOT touch schema.json (the LLM doesn't produce this field).
- `/api/problems` rows and `studentSafeProblem` include `difficulty` when
  present.
- Web: chalk-scribble badge — lowercase mono text (`easy`/`medium`/`hard`),
  TRANSPARENT background, 1px colored border pushed through
  `filter: url(#chalk-rough)`, slight rotation like `.badge`. Colors:
  easy `var(--sky)`, medium `var(--amber)`, hard `var(--coral)` (text +
  border same color). Shown: next to the problem `<h1>` on the desk, and
  right-aligned-ish on ledger rows (before the meta). Absent difficulty →
  no badge.
- **Backfill script** `scripts/backfill-difficulty.mjs` (committed, reusable):
  for each `cards/*.card.json` missing `difficulty`, resolve the LC slug
  (card name; map underscore names: two_sum→two-sum, house_robber→
  house-robber, container_water→container-with-most-water), fetchProblem,
  patch the json in place. RUN IT as part of this task (it touches
  cards/ — that's the sanctioned exception; the cards are git-tracked so the
  diff is reviewable). Print a line per card.

## 9. Solved chalk stamp (web)
When the active session is solved (any attempt all-pass — derivable from
takes; also `solved` comes back on resume), render a rotated chalk-outline
stamp `solved ✓` near the problem title (sky, mono, uppercase-small,
~-8deg, chalk-rough border, subtle — a grade mark, not a firework). Set it
live when a run comes back all-pass, and on resume of a solved session.

## What NOT to do
- No new deps (pyright/python LSP is a SEPARATE increment — don't touch the
  LSP bridge).
- Don't rename DB tables/columns or API field names (`takes` stays on the
  wire; only UI copy changes).
- Don't touch prompts, engine session logic, SSE, settings panel.

## Verify before you report back
- tsc engine/server/web clean.
- Backfill: run it; show the per-card output; `git diff --stat cards/` shows
  only difficulty additions (verify with a grep for `"difficulty"` across
  cards/*.card.json).
- Scratch server: `/api/problems` rows include difficulty.
- normalizeForDirty: quick node test — trailing spaces/newlines NOT dirty;
  an indentation change IS dirty; body change IS dirty. Include output.
- UI items (1,3,4,5,7,9): typecheck + implement; visual verification is the
  supervisor's. Note anything you couldn't exercise.

## Report back
Files changed, commands run + outputs, and residual risk. Note anything in
the spec that didn't match reality.
