# The vocab — boxed board section, amber chalk title, columns, info icon

Visual upgrade of the vocabulary block (user feedback 2026-07-10). Files:
`web/src/App.tsx`, `web/src/index.css` only.

## Intent

Make the vocab read as a titled section chalked off on the board — the way a
teacher rules off a corner and writes a heading above it. Rename to
**"the vocab"**, written in yellow chalk. Bigger, and terms always flow in
multiple columns. A small chalk-circled info icon explains the concept.

## Markup (App.tsx)

Replace the current aside content:

```tsx
<aside className="vocab chalk" aria-label="the vocab">
  <div className="vocab-head">
    <span className="vocab-title">the vocab</span>
    <button type="button" className="vocab-info" aria-label="what is the vocab?">
      i
      <span className="vocab-tip" role="tooltip">
        the ideas this problem is built on. the smudged ones I won't say yet —
        commit to an idea of your own and I'll write it up here.
      </span>
    </button>
  </div>
  <div className="vocab-words">
    ...earned words then smears, exactly as today...
  </div>
</aside>
```

Note the `chalk` class on the aside — that's the app's hand-drawn outline
treatment (`.chalk::before` + `#chalk-rough`); reuse it, do not hand-roll a
border. Keep the earned/fresh/smear rendering and `smearWidth` logic
unchanged.

## CSS (index.css) — replace the current .vocab rules

Layout sizing (bigger):
- `.problem.has-vocab`: `grid-template-columns: minmax(0, 1fr) clamp(260px, 34%, 400px)`;
  `max-width: min(100%, 1140px)`; keep column-gap 28px.

The frame:
- `.vocab`: `position: relative; padding: 20px 18px 16px; background: rgba(16, 26, 21, 0.4);`
  (the `.chalk::before` outline supplies the border — check how other `.chalk`
  panels set it up and match; if the outline needs the `lit` variant for
  visibility on this background, use `chalk lit` in the markup instead).
- `.vocab-head`: `position: absolute; top: -11px; left: 12px;` flex row,
  gap 8px, align-items center — the title sits ON the frame's top rule, with a
  slab of the page background behind it so the chalk line breaks around it:
  `background: var(--slate-deep)` (check the actual bg token/color used by the
  desk and use that; add `padding: 0 8px`).
- `.vocab-title`: yellow chalk handwriting — `font-family: var(--display);
  font-weight: 700; font-size: 15px; letter-spacing: 0.02em; color: var(--amber);
  transform: rotate(-1.2deg); text-shadow: 0 0 10px rgba(240, 195, 74, 0.25);`
  lowercase text as written.

Info icon:
- `.vocab-info`: a wobbly chalk circle with a mono "i" — `width: 17px; height: 17px;
  border-radius: 50%; border: 1.5px solid var(--chalk-faint);
  filter: url(#chalk-rough);` background transparent, color `var(--chalk-dim)`,
  `font-family: var(--mono); font-size: 10px; line-height: 1;` centered (flex),
  cursor: help, padding 0. On `:hover` / `:focus-visible`: border-color + color
  `var(--amber)`. Visible focus outline off (the color change is the focus
  indicator) but keep `:focus-visible` styling distinct.
  NOTE: `filter` on the button would blur the tooltip child too — put the
  chalk-rough filter on the button but render the tooltip OUTSIDE the filter's
  effect by... simplest: don't nest. Move `.vocab-tip` to be a sibling of the
  button inside `.vocab-head`, shown via
  `.vocab-info:hover + .vocab-tip, .vocab-info:focus-visible + .vocab-tip { opacity: 1; }`.
  Adjust the markup accordingly (tooltip as sibling span, `aria-describedby`
  + an id on the tip).
- `.vocab-tip`: absolutely positioned below the head (`top: calc(100% + 8px);
  left: 0; width: 240px; z-index: 5;`), chalk panel look: background
  `#1b2a22`-ish (match the settings panel's slate), 1.5px chalk-faint border
  with `filter: url(#chalk-rough)` — NO border-radius (design rule: no rounded
  rects) — `padding: 10px 12px; font-family: var(--body); font-size: 12.5px;
  line-height: 1.5; color: var(--chalk-dim);` `opacity: 0` +
  `pointer-events: none` + small `transition: opacity 120ms`; opacity 1 when
  shown (rule above). Text is normal case as given in the markup.

Columns (always several):
- `.vocab-words`: replace flex column with CSS columns:
  `column-count: 2; column-gap: 22px;`
- `.vocab-word`, `.vocab-smear`: `display: block; break-inside: avoid;
  margin-bottom: 8px;` (drop the flex gap). Keep existing fonts, rotations,
  smear visuals, and the `.fresh` write-in animation exactly as they are.

Narrow fallback (<=860px media block): the aside flows below constraints
full-width; give `.vocab-words` `column-count: 3` there (wide row fits three).

Reduced motion rule stays as-is.

## Do NOT touch

Server, api.ts, vocab state logic, smearWidth, finishReveal. Nothing outside
the two files.

## Verify

`npx tsc --noEmit` clean in `web/`. No servers — orchestrator checks visuals.

## Report back

Files changed, commands run, residual risk.
