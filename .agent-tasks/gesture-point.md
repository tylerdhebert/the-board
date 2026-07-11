# POINT — the tutor points at a line of the student's code

First gesture from `docs/gestures.md` (READ IT FIRST — it is the design
contract). Files: `prompts/teacher_tmpl.md`, `engine/src/teacher.ts`,
`engine/src/session.ts`, `server/src/server.ts`, `web/src/api.ts`,
`web/src/App.tsx`, `web/src/CodeEditor.tsx`, `web/src/index.css`.

## 1. Teacher prompt (prompts/teacher_tmpl.md)

Add a `## Gestures` section after the MODE/de-escalation material:

```
## Gestures
After the MODE line you may add ONE gesture line:

POINT: <lineNumber> | <exact copy of that line from ./editor.<ext>>

This draws a chalk arrow at that line of the student's editor, anchored to
your reply. Use gestures when needed to illustrate a point. Copy the line
EXACTLY as it appears in the file — if it does not match, the gesture is
dropped. Point only at the student's own code.
```

(The exact sentence "Use gestures when needed to illustrate a point." is a
deliberate user decision — do not reword it.)

## 2. Parse + strip (engine/src/teacher.ts)

- `TeacherReply` gains `point?: { line: number; quote: string }`.
- After the MODE line is consumed, if the next non-empty line matches
  `/^POINT:\s*(\d+)\s*\|\s*(.+)$/i`, capture `{ line: Number($1), quote: $2.trim() }`,
  drop that line from `reply` (same slicing pattern as MODE), and return it
  on the TeacherReply. Constraints: line must be a positive integer and
  quote non-empty, else ignore the line entirely (leave it in the reply? NO
  — if it LOOKS like a POINT line but fails the regex constraints, strip it
  anyway and return no point; a half-formed control line must never reach
  the student).
- When there is no MODE line (the fallback branch), do not attempt POINT
  parsing — fallback replies stay as-is.

## 3. Gate sees the gesture (engine/src/session.ts)

Where `gateCheck` is called (both draft and redraft), if `t.point` exists,
pass the draft as:

```
t.reply + `\n\n[gesture: points at editor line ${t.point.line}: \`${t.point.quote}\`]`
```

(Only the string handed to gateCheck changes — the reply kept for the
transcript/result stays clean.) A REVISE verdict already causes a redraft;
nothing else needed.

## 4. Thread through (engine/src/session.ts, server/src/server.ts, web/src/api.ts)

- `TurnResult` (engine session.ts) gains `point?: { line: number; quote: string }`
  — set from the FINAL accepted teacher turn (the redraft's point if it
  redrafted; a redraft without a POINT line clears it).
- The transcript/persisted note text stays prose-only (gestures are
  ephemeral — see docs/gestures.md). Do NOT persist point anywhere.
- server submit endpoint: include `point: result.point` in the SSE `result`
  event payload.
- web api.ts: `TurnResult` gains `point?: { line: number; quote: string }`.

## 5. Client validation + render (web/src/App.tsx, web/src/CodeEditor.tsx)

State in App: `const [point, setPoint] = useState<{ line: number; quote: string } | null>(null)`.

- In `turn()`'s success path: stash `r.point ?? null` on the note object
  (`Note` gains `point?`) but DO NOT activate it yet.
- In `finishReveal(index)` (gestures land after the reveal, like unlocks):
  if the revealed note has a point, VALIDATE against the current `code`
  state: split into lines; if `lines[point.line - 1]?.trim() === quote`
  → activate as-is. Else find lines whose trim equals the quote: exactly
  one match → snap to that line; zero or several → drop (setPoint(null),
  no chip). On activation: `setPoint({ line: resolvedLine, quote })`.
- The note chip: when a tutor note carried an ACTIVATED point, render a
  small `↳ line N` chip in the note's `.who` row (same badge styling family
  as the mode badge, amber). Store the resolved line back onto the note for
  the chip. If the gesture was dropped, no chip.
- Lifecycle (all in App): clear `point` on: checkoutTake, resetToScaffold,
  changeLang, session switch/fresh session/wordmark home, and when a new
  POINT activates (replace). Editing the pointed line: pass the point down
  to CodeEditor; CodeEditor clears the decoration itself (below) and calls
  an `onPointInvalid` callback so App can null the state.

### CodeEditor (web/src/CodeEditor.tsx)

New optional props: `point: { line: number; quote: string } | null`,
`onPointInvalid: () => void`.

- Effect on `point`: clear previous decorations
  (`editor.deltaDecorations(old, [])`). When non-null, add one decoration:
  `range: new monaco.Range(line, 1, line, model.getLineMaxColumn(line))`,
  options: `isWholeLine: true, className: 'point-line',
  glyphMarginClassName: 'point-glyph', stickiness: NeverGrowsWhenTypingAtEdges`.
  Enable the glyph margin lazily: set `glyphMargin: true` in editor options
  (safe to set always at mount).
- On `onDidChangeModelContent` (there is an existing content listener —
  extend it or add one scoped to the point effect): re-check
  `model.getLineContent(line).trim() === quote`; if the line no longer
  matches (or line out of range), clear decorations + `onPointInvalid()`.
  Track the decoration ids + the active point in refs; dispose listener on
  cleanup.

### CSS (web/src/index.css)

- `.point-line`: `background: rgba(240, 195, 74, 0.07);
  box-shadow: inset 2px 0 0 rgba(240, 195, 74, 0.65);`
- `.point-glyph::after`: content `'➜'` (or a small CSS triangle), color
  `var(--amber)`, `filter: url(#chalk-rough);` positioned center; ~12px.
- `.note .badge.point`: reuse the existing badge styles with amber text —
  match `.badge` variants already present.
- A brief attention pulse on activation:
  `@keyframes point-pulse { from { background: rgba(240,195,74,0.22); } }`
  `.point-line { animation: point-pulse 900ms ease-out; }`
  Under `prefers-reduced-motion: reduce`: `animation: none`.

## 6. Do NOT

- Do not persist gestures (no store/db/notes changes).
- Do not touch gate.ts, unlock, ingest, stress, vocab, cards.
- Do not add a gesture other than POINT.

## Verify

- `npx tsc --noEmit` clean in `engine/`, `server/`, `web/`.
- Engine-level check REQUIRED (add a throwaway script under
  `.agent-tasks/checks/point-parse.mjs` is fine — or run inline with tsx):
  drive `teacherTurn`'s PARSING by importing the module? The parser lives
  inside teacherTurn; simplest: export a small pure helper
  `parseTeacherReply(raw: string): TeacherReply` used by teacherTurn, and
  unit-drive THAT with: MODE+POINT (valid), MODE only, POINT with bad line
  number, POINT with missing pipe, no MODE fallback. Print results; include
  the output in your report.

## Report back

Files changed, commands run (with the parse-check output), residual risk.
