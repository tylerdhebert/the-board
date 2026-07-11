# SHOW + TAP gestures, and the gesture union refactor

Gestures 2 and 3 from `docs/gestures.md` (READ IT FIRST). POINT shipped
yesterday; this generalizes the protocol and adds two gestures. Files:
`prompts/teacher_tmpl.md`, `engine/src/teacher.ts`, `engine/src/session.ts`,
`server/src/server.ts`, `web/src/api.ts`, `web/src/App.tsx`,
`web/src/index.css`, `.agent-tasks/checks/point-parse.mjs` (extend it).

## 1. Refactor: one gesture union (engine/src/teacher.ts, session.ts, wire)

The protocol is "at most ONE gesture line" — model it that way while the
surface is a day old:

```ts
export type TeacherGesture =
  | { kind: 'point'; line: number; quote: string }
  | { kind: 'show'; caseNumber: number }   // 1-based, officials then tougher
  | { kind: 'tap' }
```

- `TeacherReply.point` → `TeacherReply.gesture?: TeacherGesture`.
- `parseTeacherReply`: after the MODE line, ONE optional control line
  matching any of (case-insensitive):
  - `POINT: <digits> | <nonempty>` → point (existing constraints)
  - `SHOW: case <digits>` (also accept `SHOW: <digits>`) → show, number ≥ 1
  - `TAP: vocab` (also accept bare `TAP:`) → tap
  A line starting with `POINT:`/`SHOW:`/`TAP:` that fails its format is
  STRIPPED and yields no gesture (half-formed control lines never reach the
  student). Only the FIRST control line is consumed; any further
  control-looking lines are left as-is (the prompt says one).
- `TurnResult.point` → `TurnResult.gesture?: TeacherGesture`.
- session.ts gateDraft generalizes:
  - point: `[gesture: points at editor line N: \`quote\`]` (unchanged text)
  - show:  `[gesture: shows the class case N: \`<input>\`]` where input is
    looked up from the card (below)
  - tap:   `[gesture: taps the vocab board without revealing anything]`
- **Server-side SHOW validation in session.ts (it has the card):** total =
  `card.examples.length + (card.stress?.length ?? 0)`; if
  `caseNumber < 1 || caseNumber > total`, DROP the gesture entirely (treat
  as none — not passed to gate, not returned). For the gate summary, resolve
  the input string: `n <= examples.length ? examples[n-1].input : stress[n-1-examples.length].input`.
- **TAP validation in session.ts:** if `this._lockedTerms.length === 0`,
  drop (nothing to tap at).
- server submit SSE result: `point: result.point` → `gesture: result.gesture`.
- web api.ts: `TurnResult.point` → `gesture?: { kind: 'point'; line: number; quote: string } | { kind: 'show'; caseNumber: number } | { kind: 'tap' }`.
- App.tsx: adapt the existing POINT plumbing to `gesture.kind === 'point'`
  (Note stores the gesture; finishReveal switches on kind). POINT behavior
  must remain EXACTLY as it is today.

## 2. Teacher prompt (prompts/teacher_tmpl.md)

Replace the Gestures section body with:

```
## Gestures
After the MODE line you may add ONE gesture line:

POINT: <lineNumber> | <exact copy of that line from ./editor.<ext>>
  — draws a chalk arrow at that line of the student's editor. Copy the
  line EXACTLY as it appears in the file; if it does not match, the
  gesture is dropped. Point only at the student's own code.

SHOW: case <n>
  — pulls a copy of test case n out of the deck and lays it in the margin
  next to your reply. Case numbers are listed under CASES below.

TAP: vocab
  — taps the vocabulary board: the still-smudged words shimmer for a
  moment. Use it when the student is circling an idea whose name they
  have not earned yet — it says "there's a word for what you just said"
  without saying it.

Use gestures when needed to illustrate a point.
```

(Keep the final sentence EXACTLY as written — user decision.)

Add a CASES block to the template + teacher.ts fill: a numbered list the
teacher can reference for SHOW — officials first, then tougher:

```
## Cases
{{cases}}
```

Rendered in teacherTurn from the card:
`1. two_sum([2,7,11,15], 9) -> [0,1]` … and stress rows continue the
numbering with a `(tougher)` suffix. (The teacher already holds the full
answer key server-side; this leaks nothing.)

## 3. Client — SHOW (web/src/App.tsx, index.css)

Per docs/gestures.md: the card renders INLINE IN THE TUTOR'S NOTE (chat
margin), animated in as if dragged from the deck. NOT the fan overlay.

- Note gains the gesture; in `finishReveal`, kind 'show': validate
  `1 <= caseNumber <= problem.examples.length + problem.stress.length`
  (drop otherwise, like point-drop: remove from the note).
- Render, inside the note (after the `.say` text, before `.unlocked`), when
  the note has an activated show gesture and `!n.revealing`:

```tsx
<div className="note-card-wrap">
  <div className="index-card note-card">
    ...same content structure as fan cards: card-head (input),
    expected line, got line + stamps when run state exists...
  </div>
</div>
```

- Content derives AT RENDER TIME from `problem.examples`/`problem.stress` +
  `selectedResults` using the SAME mapping the stacks use (officials by
  index, stress by index). Live-updating run state on the inline card is
  correct behavior. Tougher cards get the same subtle amber edge treatment
  as the fan's stress cards if one exists; officials plain.
- Size: ~200px wide, min-height 110px, slightly rotated (-1.2deg), the
  ruled-card material (reuse `.index-card`).
- Animation `.note-card-wrap`: dealt in from the deck's direction (the desk
  is to the LEFT of the margin):
  `@keyframes card-drag-in { from { transform: translate(-46px, 10px) rotate(-7deg); opacity: 0; } }`
  350ms ease-out, once. `prefers-reduced-motion: reduce` → none.
- Ephemeral: notes persist text only; on resume the card simply doesn't
  re-render (gesture was never persisted). No chip needed — the card IS the
  visual.

## 4. Client — TAP (web/src/App.tsx, index.css)

- In `finishReveal`, kind 'tap': if `vocab == null || vocab.lockedCount === 0`
  → drop. Else trigger a one-shot wiggle on the smudges: a `tapNonce`
  number state; increment on tap. Render smears with
  `key={`s${i}-${tapNonce}`}` and class `vocab-smear${tapNonce > 0 ? ' tapped' : ''}`
  — the key change restarts the CSS animation; clear nothing (animation is
  `forwards`-less, runs once per remount).
  Simpler alternative allowed: a `tapping` boolean set true then false via
  800ms timeout, class toggles. Either way, the effect must be able to
  re-fire on a second TAP in a later turn.
- `.vocab-smear.tapped`: animation `smear-wiggle 700ms ease-in-out` —
  keyframes: slight rotate oscillation (±2deg) + opacity up to 0.85 and
  back, with `animation-delay` staggered per index via
  `style={{ animationDelay: `${i * 40}ms` }}` on the tapped class only.
  `prefers-reduced-motion: reduce` → opacity pulse only (no rotation), via
  a reduced variant or `animation: none` + a transition fallback; keep it
  simple: `animation: none` under reduced motion.

## 5. Extend the parse check (.agent-tasks/checks/point-parse.mjs)

Add cases: valid SHOW (`SHOW: case 3`), `SHOW: 2` shorthand, SHOW with
garbage number (stripped, no gesture), valid TAP, `TAP: vocab`, TAP with
trailing junk (accept `TAP: vocab` only + bare `TAP:`; `TAP: something-else`
is stripped-no-gesture), POINT regression cases still passing, and
"SHOW line after a POINT line" (first consumed, second left in body).
Include the output in your report.

## Do NOT

- No persistence of gestures anywhere.
- Do not touch gate.ts, vocab server logic, stacks/fan internals beyond
  reusing their CSS classes.
- POINT behavior unchanged (only the field/shape rename).

## Verify

`npx tsc --noEmit` clean in engine/, server/, web/. Run the extended parse
check and include output. No servers.

## Report back

Files changed, commands run + parse output, residual risk.
