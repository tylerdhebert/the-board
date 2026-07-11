# Interactive scaffold blanks — fill in the ____ and send it back

Round D-3, greenlit by the user 2026-07-11. Runs AFTER the show-tap task
lands (shares files). Files: `prompts/teacher_tmpl.md`, `web/src/App.tsx`,
`web/src/index.css`. NO engine/server changes — blanks are a rendering
convention, not a control line.

## The idea

Scaffold mode is the deepest de-escalation: faded pseudocode with holes.
Make the holes real: the tutor's scaffold renders with inline chalk inputs
where the `____` blanks are; the student fills them in and clicks
"send it back", which composes the completed scaffold into their next turn.

## 1. Teacher prompt (prompts/teacher_tmpl.md)

In the existing scaffold-mode guidance (the de-escalation section), add:

```
When you give scaffold pseudocode, mark each hole the student must fill
with exactly ____ (four underscores). Use 2–6 holes. Put each hole where
one short expression or line fragment belongs — never a whole solution
step. The student can fill the holes in and send the scaffold back to you.
```

## 2. Client rendering (web/src/App.tsx)

Trigger: a tutor note with `mode === 'scaffold'` whose text contains
`/_{4,}/` renders through a blank-aware renderer INSTEAD of the markdown
renderer (`renderMd(parseMd(...))`). Everything else keeps markdown.
(Scaffold replies are pseudocode-dominant; losing md styling there is an
accepted trade — note it in code with one comment.)

Blank renderer:
- Split the note text on `/_{4,}/`. Render segments as plain text inside a
  `<div className="say scaffold-say">` with `white-space: pre-wrap`,
  interleaved with inputs:

```tsx
<input
  className="blank"
  size={Math.max(6, (values[k] ?? '').length + 1)}
  value={values[k] ?? ''}
  disabled={busy || n.sentBack}
  onChange={...update values[k]...}
/>
```

- State lives ON the note: `Note` gains `blanks?: string[]` and
  `sentBack?: boolean`. Update via `setNotes` (map by index, replace the
  blanks array immutably). Values are ephemeral (notes persist text only —
  on resume the blanks render empty and editable again; acceptable).
- Under the note (when it has blanks, is not revealing, and not sentBack):
  a "send it back" button (reuse the `.review` chalk-amber button style
  family, smaller). Disabled while `busy` or while EVERY blank is empty.
- On click: compose the filled text = original note text with the i-th
  `/_{4,}/` occurrence replaced by `values[i].trim() || '____'`. Then:
  - mark the note `sentBack: true`
  - `void turn(payload, '↳ sent the scaffold back')` where payload =
    `"Here is your scaffold with my blanks filled in:\n\n" + filled`
    (display label short; full filled scaffold rides hidden, same pattern
    as review-my-work).
- During the typewriter reveal blanks must not render (revealing notes
  already render through RevealingText — leave that path alone; the blank
  renderer only applies to settled notes).

## 3. CSS (web/src/index.css)

- `.scaffold-say .blank`: inline chalk input — transparent background,
  no border except `border-bottom: 1.5px solid var(--rose)` (rose is the
  scaffold accent already used by `.badge.scaffold`), color `var(--chalk)`,
  `font-family: var(--mono); font-size: 12.5px; padding: 0 2px;`
  outline none; focus: border-bottom-color `var(--amber)`; disabled:
  opacity 0.7, border-bottom-style dotted.
- `.sendback`: small chalk-outline button under the note, amber text,
  lowercase, mono 11px — visually quieter than "review my work".
- Nothing else.

## Do NOT

- No engine/server/api changes at all.
- No persistence of blank values.
- Do not alter how non-scaffold notes render.
- Markdown renderer untouched.

## Verify

`npx tsc --noEmit` clean in `web/`. No servers.

## Report back

Files changed, commands run, residual risk.
