# Review-batch polish: visible review notes, stress propagation, –/N chips

Three small fixes from the user's review of the current uncommitted batch.
The working tree contains a LARGE uncommitted feature batch — change ONLY
what this spec says; touch nothing else.

## 1. Review notes visible in the transcript (web/src/App.tsx + index.css)

Today `review()` sends the composer text as hidden payload (`My notes:` inside
`reviewPrompt(notes)`) but displays only the label `↳ review my work` — the
student's own notes vanish from the visible margin and from resumed sessions.

Fix by folding the notes into the DISPLAY text (persistence shape must NOT
change — notes are stored as plain text rows):

- In `review()`: when `notes` is non-empty, pass
  `'↳ review my work\n' + notes` as the display argument; otherwise keep the
  bare label. The hidden send payload stays exactly as it is now.
- In the student-note renderer (the `.say` branch for `n.role !== 'tutor'`,
  around line 1240): when a student note's text starts with `'↳'` AND contains
  a newline, split on the FIRST newline: render the first line exactly as
  today, and render the remainder underneath in a new
  `<span className="say-sub">` (inside the same `<p className="say">` is fine,
  or a sibling — match surrounding structure).
- CSS for `.say-sub` (near the existing `.note.you .say` rules): block display,
  smaller and dimmer than body text (e.g. `font-size: 12.5px`, color
  `var(--chalk-dim)`, `opacity: 0.85`, `margin-top: 3px`), clamped to two
  lines with an ellipsis:
  `display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;`
  Keep `white-space: pre-wrap` OFF for the sub (it must clamp, not preserve
  every newline) — override with `white-space: normal`.
- This works transparently for resumed sessions because the composed display
  text is what gets persisted (server already persists the display string).

## 2. Stress rows propagate to sibling sessions (server/src/server.ts)

Today the `/stress` endpoint sets `entry.card.stress` on the ONE session that
clicked the button and saves the card file. Other already-in-memory sessions
on the SAME card keep their stale `card` object and stale `entry.cases`, so
their runs silently exclude the new tougher cases until a server restart.

Fix inside the stress endpoint's inflight promise, right after
`await saveCard(entry.cardName, entry.card)`: iterate the module-level
`sessions` map and for every OTHER entry whose `cardName` matches, set
`sibling.card.stress = rows` and `delete sibling.cases` (so `ensureCases`
rebuilds official+stress on that session's next run). Keep it synchronous —
no awaits in the loop.

Also handle the early-return path: before generating, the endpoint returns the
cached count when `entry.card.stress` is already non-empty. A sibling that
was restored BEFORE the card gained stress could hit the generate path even
though the card file on disk already has rows — harmless (generation is
idempotent-ish) but wasteful. Cheap guard: at the top of the endpoint, if
`entry.card.stress` is empty, re-check by reloading the card from disk
(`loadCard(entry.cardName)`) and if THAT has stress rows, adopt them
(`entry.card.stress = loaded.stress; delete entry.cases`) and return the
cached count instead of generating.

## 3. Restore `–/N` on unrun attempt chips (web/src/App.tsx)

`takeScoreLabel` now returns `'–/–'` for takes with `results == null` (or
error). Before the batch, the UI showed `–/N` when the case total was known.
Restore that:

- Compute a known official-case total near where `stressCount` is derived:
  scan `takes` for the newest take with non-null `results` and no error, and
  use its `officialCases(res).length`. Fall back to `null`.
- Pass it to `takeScoreLabel` (add a second parameter `knownTotal:
  number | null`) and in the `res == null || res.error` branch return
  `knownTotal == null ? '–/–' : `–/${knownTotal}``.
- Leave the with-results format (`x/y` and `x/y · a/b tough`) unchanged.

## Do NOT touch

- Anything else in the working tree (it holds a large unrelated uncommitted
  batch and the user's HANDOFF.md edits). Only `web/src/App.tsx`,
  `web/src/index.css`, `server/src/server.ts`.
- No dependency, schema, or persistence changes.

## Verify

- `npx tsc --noEmit` clean in `web/` and `server/` (run from each package dir).
- Do NOT start servers; the orchestrator verifies live behavior separately.

## Report back

Files changed, commands run, residual risk.
