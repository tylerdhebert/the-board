# The cases as flash cards — two stacks, Balatro fan overlay

User direction 2026-07-10. Replaces the `.takes-cases` debug-log strip
entirely. Files: `server/src/server.ts`, `web/src/api.ts`, `web/src/App.tsx`,
`web/src/index.css`.

## 0. Scrollbar regression fix (index.css, do this first, standalone)

The `html { scrollbar-color; scrollbar-width }` fallback added earlier takes
PRECEDENCE over `::-webkit-scrollbar` styling in current Chromium, which
re-enabled the native rounded thumb + arrow buttons. Fix:
- DELETE the whole `html { scrollbar-color: ...; scrollbar-width: ...; }` rule.
- Change `*::-webkit-scrollbar` width/height from 7px to **5px**.
- Add `*::-webkit-scrollbar-button { display: none; width: 0; height: 0; }`.
- Thumb stays a plain square rectangle (no radius), `var(--chalk-line)`,
  hover `var(--chalk-faint)`. This app is Chromium-only (Electron/Chrome).

## 1. The concept

The example cases become physical **ruled index cards** — the problem's
material (paper + ink) against the tutor's material (chalk). Under the
editor sit **two stacks side by side**: `examples` and `tougher`. Clicking a
stack fans its cards out in a full-screen overlay like a card hand in
Balatro; hovering (or focusing) a card lifts it. Runs paint pass/fail state
onto the cards. Text stays fully legible — existing app fonts, no
handwriting faces.

## 2. Server (server/src/server.ts)

The client needs case content before any run:
- In `studentSafeProblem` (server/src/engine.ts — allowed for this one
  change): add `examples: card.examples` (public statement content:
  `{input, output}[]`) and `stress: card.stress ?? []` (oracle rows — their
  outputs already reach the client in run results today, so this leaks
  nothing new). Update its return type accordingly.
- The `/stress` endpoint response: also return the rows —
  `{ count, stress: entry.card.stress }` — so the client can show new cards
  without a reload.

LEAK CHECK: examples/stress are the ONLY additions. No optimal, ladder,
leak_terms, traps, key_insight, hints.

## 3. Client data (web/src/api.ts)

- `export type CaseRow = { input: string; output: string }`
- `Problem` gains `examples: CaseRow[]` and `stress: CaseRow[]`.
- `chalkStress` return type becomes `{ count: number; stress: CaseRow[] }`.

## 4. Client state & mapping (web/src/App.tsx)

- On `chalkUpTougher` success: also `setProblem(p => p ? { ...p, stressCount: count, stress: res.stress } : p)`.
- Case state mapping: the newest results come from `selectedResults`
  (existing). Official case i maps to `problem.examples[i]`, stress case j
  to `problem.stress[j]` (extractCases preserves order; runStudentCode
  returns cases in the same order: officials first, then stress). Build:

```ts
type CardState = { input: string; expected: string; got?: string; error?: string; pass?: boolean }
```

  For each example/stress row, start from `{input, expected: output}`; if
  `selectedResults` exists without a top-level error, overlay the matching
  RunCaseResult's `got`/`error`/`pass` (match officials by index against
  `officialCases(selectedResults)`, stress against `stressCases(...)`).
- Overlay state: `const [openStack, setOpenStack] = useState<null | 'examples' | 'tougher'>(null)`.
  Esc closes (extend the existing settings Escape handler pattern with its
  own effect). Clicking the backdrop closes. Opening is a plain click on the
  stack button.
- DELETE the old `.takes-cases` render block, the `stressbtn` +
  `stress-count` elements in `.workactions` (chalk-up moves into the tougher
  stack), and any now-unused helpers. KEEP the attempts rail and run button
  exactly as they are.

## 5. Rendering (App.tsx + index.css)

### The stacks row (always visible while a problem is open)

Below the workrow (where .takes-cases was):

```tsx
<div className="case-stacks">
  <button type="button" className="case-stack" onClick={() => setOpenStack('examples')}>
    <span className="stack-card ghost g2" /><span className="stack-card ghost g1" />
    <span className="stack-card top">
      <span className="stack-label">examples</span>
      <span className="stack-meta">{/* "3 cards" or "2✓ 1✗" after a run */}</span>
    </span>
  </button>
  {tougher stack: same structure when problem.stress.length > 0;
   otherwise a chalk-up placeholder:}
  <button type="button" className="case-stack empty" disabled={stressing} onClick={() => void chalkUpTougher()}>
    <span className="stack-card top dashed">
      <span className="stack-label">{stressing ? 'chalking…' : 'chalk up'}</span>
      <span className="stack-meta">tougher cases</span>
    </span>
  </button>
</div>
```

Stack meta line: before any run `${n} cards`; after a run
`${passCount}✓ ${failCount}✗` (omit zero parts).

### The card material (both collapsed tops and fanned cards share it)

`.index-card` base class:
- Paper: `background: linear-gradient(180deg, #f6f2e7, #efe9da);`
  ink text `#2b3034`; NO border-radius beyond 2px; box-shadow
  `0 2px 6px rgba(0,0,0,0.35)`.
- **Ruled lines** via layered gradients ON TOP of the paper gradient:
  - soft red header line: `linear-gradient(to bottom, transparent 26px, rgba(214,106,106,0.55) 26px, rgba(214,106,106,0.55) 27.5px, transparent 27.5px)`
  - soft blue rules every 20px starting below the header:
    `repeating-linear-gradient(to bottom, transparent 0 18.5px, rgba(120,156,204,0.4) 18.5px 20px)` — offset the repeating layer with
    `background-position` so rules start at ~44px.
  Combine: rules layer, header layer, paper gradient (in that order).
- Text sits wherever it lands — do NOT try to align text to the rule lines.
- Fonts: `.card-head` (the input call) in `var(--mono)` 12px ink,
  positioned in the header zone (padding-top ~6px); body lines
  (`expected:` / `got:`) in `var(--mono)` 12px, labels in `var(--body)`
  11px `#6a7076`.

### Collapsed stacks

- `.case-stack`: transparent button, `position: relative;
  width: 190px; height: 120px;` cursor pointer.
- `.stack-card`: absolute inset index-card; `.g1 { transform: rotate(1.6deg) translate(3px, 3px); }`
  `.g2 { transform: rotate(-2.1deg) translate(-3px, 5px); }` (ghost layers,
  slightly darker paper, no text).
- `.top`: flex column, label + meta. `.stack-label` in `var(--body)` 600
  13px ink; `.stack-meta` 11px `#6a7076`; fail state meta shows `✗` count in
  `#b4453a`, pass `✓` in `#2f7d4f` (ink colors — paper world, not chalk).
- Hover: top card `transform: translateY(-3px) rotate(-0.5deg)`,
  shadow deepens. Transition 130ms.
- `.case-stack.empty .top.dashed`: no paper fill — transparent with a 1.5px
  dashed `var(--chalk-faint)` border and chalk-dim text (it belongs to the
  chalk world until real cards exist).

### The fan overlay (Balatro hand)

```tsx
{openStack && (
  <div className="fan-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setOpenStack(null) }}>
    <div className="fan-hand">
      {cards.map((c, i) => (
        <div key={i} className={`index-card fan-card${c.pass === true ? ' pass' : c.pass === false ? ' fail' : ''}`}
             style={fanTransform(i, cards.length)} tabIndex={0}>
          <div className="card-head">{c.input}</div>
          <div className="card-line"><span className="card-label">expected</span> {c.expected}</div>
          {c.got !== undefined && <div className="card-line"><span className="card-label">got</span> {c.got}</div>}
          {c.error && <div className="card-line err">{c.error}</div>}
          {c.pass === true && <span className="card-stamp ok">✓</span>}
          {c.pass === false && <span className="card-stamp no">✗</span>}
        </div>
      ))}
    </div>
  </div>
)}
```

- `.fan-backdrop`: fixed inset 0, `background: rgba(13, 17, 14, 0.72)`,
  z-index 30, display grid, `place-items: center end` — hand sits in the
  lower half (Balatro): `align-items: end; padding-bottom: 12vh;`
- `.fan-hand`: `position: relative; width: min(80vw, 1100px); height: 300px;`
- Fan math (a helper in App.tsx):

```ts
function fanTransform(i: number, n: number): CSSProperties {
  const c = i - (n - 1) / 2
  const spread = Math.min(150, 760 / Math.max(n - 1, 1))
  const rot = c * Math.min(7, 26 / Math.max(n - 1, 1) * 2)
  const lift = Math.abs(c) * Math.abs(c) * 7
  return {
    position: 'absolute', left: '50%', bottom: 0,
    transform: `translateX(calc(-50% + ${c * spread}px)) translateY(${lift}px) rotate(${rot}deg)`,
    zIndex: 10 + i,
  }
}
```

- `.fan-card`: `width: 260px; height: 170px; padding: 6px 12px 10px;
  transform-origin: 50% 120%; transition: transform 140ms ease-out,
  box-shadow 140ms;` overflow hidden; `word-break: break-word` on the head.
- Hover/focus lift — IMPORTANT: the base transform is inline (per-card), so
  the lift must compose, not replace. Do it with a nested wrapper: the
  positioned outer div carries the fan transform; give the CARD ITSELF an
  inner div (`.fan-card` inside `.fan-slot`) so `:hover`/`:focus-visible` on
  the inner applies `transform: translateY(-26px) scale(1.06)` cleanly.
  Restructure the map accordingly (`.fan-slot` gets the inline style +
  zIndex; hover also bumps the slot's z-index via
  `.fan-slot:hover { z-index: 40; }`).
- Pass/fail accents on fanned cards: `.pass .card-stamp.ok` — a `#2f7d4f`
  ✓, top-right, 18px, slight rotation, opacity 0.85. `.fail` card: 2px inner
  edge `rgba(180, 69, 58, 0.7)` (box-shadow inset) + ✗ stamp `#b4453a`.
  `got` line ink turns `#b4453a` on fail.
- Entry animation: cards deal from the bottom
  (`@keyframes deal { from { transform: translateY(60px); opacity: 0; } }`
  on the slot, 180ms, staggered `animation-delay: i * 30ms` via inline
  style). Under `prefers-reduced-motion: reduce`: no deal animation, no
  hover lift transition.
- The `tougher` fan uses the same overlay with `problem.stress` cards.

### Placement

`.case-stacks`: `margin-top: 14px; display: flex; gap: 18px;` sits exactly
where `.takes-cases` was (inside the same parent block, after `.workrow`).
Cards/stacks do NOT reflow the editor.

## 6. Delete

- The entire `.takes-cases` CSS block (including `.case-group`,
  `.stress-row`, etc.) and its render code.
- `.stressbtn` / `.stress-count` CSS + JSX.
- Any helpers left unused after this (typecheck will tell).

## Keep unchanged

Run button, attempts rail, solved logic, vocab board, everything else.

## Verify

`npx tsc --noEmit` clean in `web/` and `server/`. No servers.

## Report back

Files changed, commands run, residual risk.
