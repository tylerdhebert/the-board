# The vocabulary — locked leak-terms as chalk smears, earned words written in

Round D item 1 (concept board), agreed with the user 2026-07-10. Label: the
eyebrow reads **"the vocabulary"** (matches the app's "the problem" / "the
tutor" naming pattern).

## The idea

Each problem card has private `leak_terms` — the concepts the tutor won't say
until the student commits to an idea (the unlock judge removes them from the
session's locked set; `unlockedThisTurn` already flows to the client per
turn). Render this state on the board, in the dead zone to the right of the
problem statement:

- Every still-locked term = an anonymous **chalk smear** (an erased/smudged
  word on the slate).
- Every earned term = the real word, **written in chalk**.
- Earning a term live turns a smear into the written word with a brief
  write-in reveal, at the same moment the "✓ you've got it" line lands.

## LEAK DISCIPLINE (the hard rule)

The client may know ONLY:
- the **count** of locked terms, and
- the **text of already-earned** terms (they've been spoken/unlocked).

Locked term TEXT must never reach the client. Smear widths must be derived
from the slot INDEX (stable pseudo-random), never from any property of the
real term. Do not add leak_terms (or lengths, hashes, initials…) to any
payload.

## Server (server/src/server.ts only)

Add a student-safe vocab snapshot to the three payloads that establish a
session on the client:

```ts
function vocabFor(entry: SessionEntry): { lockedCount: number; earned: string[] } {
  const locked = new Set(entry.session.lockedTerms);
  return {
    lockedCount: locked.size,
    earned: entry.card.leak_terms.filter((t) => !locked.has(t)),
  };
}
```

- `POST /api/session` and `POST /api/start` responses: add `vocab: vocabFor(entry)`
  (fresh sessions will naturally have `earned: []`).
- `GET /api/session/:id` (the resume payload): add `vocab: vocabFor(entry)`.
  On resume, earned order follows card order — acceptable.

The per-turn delta already exists (`unlockedThisTurn` in the submit result);
do NOT add vocab to the submit response.

## Client — state & types (web/src/api.ts, web/src/App.tsx)

- api.ts: `export type Vocab = { lockedCount: number; earned: string[] }`;
  add `vocab: Vocab` to the createSession/startSession result types and to
  `ResumePayload`.
- App.tsx: `const [vocab, setVocab] = useState<Vocab | null>(null)` — set it
  in `applyFreshSession` and the resume path; clear it wherever the session
  state is torn down (wordmark/home, new session).
- **Update timing:** the vocab board updates when the tutor note's unlocked
  line becomes visible, i.e. in `finishReveal(index)`: if that note has
  `unlocked?.length`, apply them — append terms not already in `earned`
  (dedupe) and decrement `lockedCount` by the number actually appended
  (floor at 0). This automatically covers click-to-finish since that also
  goes through `finishReveal`. Resume needs no special handling (notes from
  resume are not `revealing`; vocab comes from the payload).

## Client — rendering (web/src/App.tsx, web/src/index.css)

Placement: inside the `<article className="problem">`, occupying the dead
zone right of the statement. Make the article a two-column grid when vocab
exists (`grid-template-columns: minmax(0, 1fr) clamp(160px, 24%, 250px)`,
column-gap ~28px): title row spans both columns (`grid-column: 1 / -1`);
statement + constraints flow in column 1; the vocab block sits in column 2
aligned to the top of the statement (`grid-row` spanning the
statement/constraints rows). Below ~860px viewport width, collapse back to
one column and let the vocab block flow after constraints. Keep the
no-vocab layout IDENTICAL to today (single column) — when the card has no
leak terms at all (`lockedCount === 0 && earned.length === 0`) or vocab is
null, render nothing and apply no grid change.

Markup:

```tsx
<aside className="vocab" aria-label="the vocabulary">
  <p className="eyebrow">the vocabulary</p>
  <div className="vocab-words">
    {vocab.earned.map((t) => (
      <span key={t} className={`vocab-word${fresh.has(t) ? ' fresh' : ''}`}>{t}</span>
    ))}
    {Array.from({ length: vocab.lockedCount }, (_, i) => (
      <span key={`s${i}`} className="vocab-smear" style={{ width: smearWidth(i) }} aria-hidden="true" />
    ))}
  </div>
</aside>
```

- `smearWidth(i)`: stable pseudo-random from the index only, e.g.
  `const w = [64, 88, 52, 76, 96, 58, 70, 82]; return w[i % w.length]` (px).
  Add a tiny per-index rotation the same way in CSS via `:nth-child` if you
  like — index-derived only.
- `fresh`: a `useState<Set<string>>` of terms earned THIS reveal; add them in
  `finishReveal`, clear each after its write-in animation (a ~1.2s timeout
  after adding is fine — no need for animationend bookkeeping).

CSS (match the design language — chalk textures, no rounded-rect cards):

- `.vocab .eyebrow` reuses the existing eyebrow style.
- `.vocab-words`: flex column, `gap: 7px`, `align-items: flex-start`.
- `.vocab-word`: font `var(--body)` ~13.5px, color `var(--chalk)`, slight
  `transform: rotate(-0.4deg)` alternating sign via `:nth-child(even)`;
  a hand-written feel, no borders.
- `.vocab-word.fresh`: write-in reveal — animate `clip-path: inset(0 100% 0 0)`
  → `inset(0 0 0 0)` over ~0.5s ease-out, plus color from `var(--amber)`
  settling to `var(--chalk)` (single keyframes animation, ~1s total).
- `.vocab-smear`: `display: block; height: 11px;` chalk-dust streak:
  `background: var(--chalk-faint)`, `opacity: 0.5`, `filter: url(#chalk-rough) blur(1.5px)`,
  small alternating rotation via `:nth-child(odd/even)`. It should read as an
  erased word on the slate, not a progress bar.
- Smears sit AFTER earned words in the same column (earned words accumulate
  at the top, smudges below).

## Do NOT touch

- Engine code (everything needed — `session.lockedTerms`, `card.leak_terms`,
  `unlockedThisTurn` — already exists).
- The existing "✓ you've got it" line in tutor notes (keep it; the vocab
  board is additive).
- Anything else in the tree.

Files allowed: `server/src/server.ts`, `web/src/api.ts`, `web/src/App.tsx`,
`web/src/index.css`.

## Verify

- `npx tsc --noEmit` clean in `web/` and `server/`.
- Do NOT start servers; the orchestrator verifies live behavior separately.

## Report back

Files changed, commands run, residual risk.
