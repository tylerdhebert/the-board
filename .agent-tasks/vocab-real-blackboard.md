# The vocab as a real blackboard — wooden frame, metal chalk rail, min height

User direction 2026-07-10: this section should read as an ACTUAL mounted
blackboard object — wooden frame around a slate surface, a metal chalk rail
along the bottom, and a minimum height so it reads as a board even when
nearly empty. Files: `web/src/App.tsx`, `web/src/index.css` only.

## Markup (App.tsx)

Restructure the aside (drop the `chalk lit` classes — the wood frame replaces
the hand-drawn outline). Keep ALL existing state/logic; only the wrapper
structure changes:

```tsx
<aside className="vocab" aria-label="the vocab">
  <div className="vocab-surface">
    <div className="vocab-head">
      <span className="vocab-title">the vocab</span>
      <button ... className="vocab-info" ...>i</button>
      <span className="vocab-tip" ...>...</span>   {/* unchanged */}
    </div>
    <div className="vocab-words">...unchanged words/smears...</div>
  </div>
  <div className="vocab-rail" aria-hidden="true">
    <span className="vocab-chalkpiece" />
  </div>
</aside>
```

## CSS (index.css) — replace the .vocab frame/head rules

New palette additions (local to these rules, desaturated so they sit in the
slate world — do NOT add to :root):
- wood mid `#57452f`, wood dark `#41341f`, wood light `#6b573c`
- rail metal light `#8a938c`, metal dark `#454e48`

The frame (`.vocab`):
- Remove the old `padding`/`background`; the aside becomes the wood frame:
  `padding: 11px 11px 0;` (rail supplies the bottom edge),
  wood texture via layered gradients:
  `background: linear-gradient(180deg, #6b573c, #57452f 30%, #4a3a26 100%);`
  plus grain: add a second layer
  `repeating-linear-gradient(92deg, rgba(0,0,0,0.10) 0 2px, transparent 2px 7px)`
  (comma-combined, grain on top).
- Bevel + object shadow:
  `border: 1px solid #41341f;`
  `box-shadow: inset 0 1px 0 rgba(255,255,255,0.10), inset 0 -1px 0 rgba(0,0,0,0.35), 0 8px 22px rgba(0,0,0,0.35);`
- Keep `align-self: start` from the grid rules. `position: relative` stays.

The surface (`.vocab-surface`):
- `min-height: 170px;` `padding: 14px 16px 16px;`
- Slate a step deeper than the page with a hint of erased-chalk residue:
  `background: radial-gradient(ellipse 75% 60% at 30% 35%, rgba(236,230,214,0.045), transparent 70%), #14211a;`
- Slight inner depth: `box-shadow: inset 0 1px 4px rgba(0,0,0,0.4);`

The head — now written ON the board (no longer breaking a frame line):
- `.vocab-head`: change from absolute to normal flow:
  `position: relative; display: flex; align-items: center; gap: 8px; margin: 0 0 12px;`
  Remove the `top/left/background/padding/z-index` slab styles.
- `.vocab-title` unchanged (amber chalk, tilt, glow).
- `.vocab-info` unchanged. `.vocab-tip` stays absolutely positioned under the
  head (`top: calc(100% + 8px); left: 0;`) — verify it still anchors to
  `.vocab-head` (it does, head is now `position: relative`).

The chalk rail (`.vocab-rail`):
- Full-width strip under the surface, inside the wood frame:
  `position: relative; height: 9px; margin: 0 -1px;`
  metal: `background: linear-gradient(180deg, #8a938c 0%, #5c655e 45%, #454e48 100%);`
  `box-shadow: inset 0 1px 0 rgba(255,255,255,0.28), 0 2px 4px rgba(0,0,0,0.4);`
- Lip: `border-top: 1px solid #2c332e;`

The chalk piece (`.vocab-chalkpiece`) resting on the rail:
- `position: absolute; top: -6px; right: 14%; width: 30px; height: 6px;`
  `background: linear-gradient(180deg, #f4efe1, #d9d3c2);`
  `border-radius: 2px;` (tiny rounding is fine on a physical object)
  `transform: rotate(-1.5deg);`
  `box-shadow: 0 1px 2px rgba(0,0,0,0.45);`

Columns and content:
- `.vocab-words` (column-width: 150px; column-gap: 22px) — UNCHANGED.
- `.vocab-word`, `.vocab-smear`, `.fresh` animation — UNCHANGED.

Media block (<=860px): keep the existing rules (`display: block`, vocab
margin-top). Nothing extra needed — the frame is self-contained.

Sanity: search index.css for any remaining rules referencing the old
absolute-head slab or `.vocab .eyebrow` leftovers and remove dead ones.

## Do NOT touch

Anything else. No new dependencies, no images/assets — gradients only.

## Verify

`npx tsc --noEmit` clean in `web/`. Orchestrator checks visuals.

## Report back

Files changed, commands run, residual risk.
