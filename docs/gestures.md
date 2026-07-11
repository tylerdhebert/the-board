# Gestures — the tutor touches the board

Design doc, agreed with the user 2026-07-11. Build order: POINT (now),
SHOW, TAP, scaffold blanks (deferred). Update this doc as gestures ship.

## Why

The tutor speaks as margin annotations, but the product is a board full of
physical objects — the editor, the vocab blackboard, the flash-card stacks.
A real tutor doesn't only talk; they point at your code, pull a card off the
deck, tap the board. Gestures give the teacher model a small, gate-checked
vocabulary of physical actions.

## The protocol

- The teacher already emits `MODE: socratic|analog|scaffold` on line 1 of
  every reply. Gestures extend the same control-line idea: **at most ONE
  optional gesture line, immediately after the MODE line**, stripped from
  the displayed text server-side.
- Strict whitelist. Anything malformed, out of range, or failing validation
  is **silently dropped — the prose always survives**. Same drop-on-failure
  ethos as the stress oracle and case extraction.
- The gate reviews text + gesture together (the gesture is summarized into
  the draft context it vets), mode-aware like everything else. A gesture
  that gives too much away is grounds for REVISE.
- Gestures ride the existing submit result (SSE `result` event) and render
  AFTER the typewriter reveal — same timing as unlocks/vocab write-ins.
- **Ephemeral.** Gestures are live theater, not transcript. They are not
  persisted and do not survive resume. Notes stay prose.

### Prompt guidance (exact wording — deliberate)

> Use gestures when needed to illustrate a point.

Not "only when it genuinely helps" (models bail out of ever using the tool),
not "every turn" (laser-pointer lecturer). State the capability plainly and
let need drive use.

## Gesture 1: POINT (shipping first)

Wire format, line 2 of the teacher reply:

```
POINT: <lineNumber> | <exact copy of that line from the student's editor>
```

The teacher reads the student's real buffer (Round B materializes it at
`./editor.<ext>` in the teacher's cwd), so it can point honestly. The quoted
content is the validity check:

- Server parses + strips the line; passes `{ line, quote }` through
  `TurnResult` to the client.
- Client verifies `editor line N (trimmed) === quote (trimmed)`. On
  mismatch (model miscounted, student edited during the turn): if the quote
  matches exactly one other line, snap to it; zero or multiple matches →
  drop the gesture.
- Render: chalk-amber underline decoration on the line + a chalk arrow in
  the gutter (Monaco decorations); the tutor's margin note gets a small
  `↳ line N` chip so the note and the arrow read as one gesture.
- Lifecycle: only the latest POINT lives; it disappears when the pointed
  line's content changes, when a different take is checked out, on reset,
  and on session switch. No persistence.

## Gesture 2: SHOW (next)

```
SHOW: case <n>            (1-based; officials first, then tougher)
```

The tutor pulls a COPY of that flash card out of the deck and **drags it
into the chat margin**: the card renders inline in the tutor's note in the
chat window (small index-card rendering, same ruled-paper material), with a
deal/drag-in animation from the direction of the stacks. It stays part of
that note's flow (scrolls with the conversation) — it is NOT the fan
overlay and does not hijack the screen. Validation: index in range of
examples+stress; out of range → drop.

Open detail when we build it: exact animation path (translate from stack
position vs. simple deal-in at the note), and whether the inline card shows
run state (leaning yes — same painting as the fan cards).

## Gesture 3: TAP (after SHOW)

```
TAP: vocab
```

The tutor taps the blackboard: the smudged (locked) vocab entries give a
brief wiggle/glow — "you're circling a word I'm not saying yet." No index,
no text, zero leak (the client already knows only the count). Rendered as a
short CSS animation on the smudge row; respects prefers-reduced-motion.

## Scaffold blanks (Round D-3 — SHIPPED, not a control line)

Scaffold-mode replies mark holes with `____` (prompted: 2–6 holes, one
short fragment each). The client renders scaffold notes containing blanks
through a blank-aware renderer (plain pre-wrap + inline chalk inputs; such
notes skip markdown — accepted trade), with a "send it back" button that
composes the filled scaffold into the next turn (short display label
"↳ sent the scaffold back", full filled text as hidden payload — the
review-my-work pattern). Blank values are ephemeral; on resume the holes
render empty and editable again. No engine/server surface at all — this is
a rendering convention, not a gesture line.

## Leak discipline (applies to every gesture)

A gesture may never encode information the student hasn't earned: no locked
term text or indices tied to meaning, no answer-bearing line content the
gate wouldn't allow in prose. POINT quotes the STUDENT'S OWN code only.
SHOW references public case rows only. TAP carries no payload at all.
