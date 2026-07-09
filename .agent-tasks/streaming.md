# Increment: streaming — progress stages over SSE + typewriter reveal

## Why (read first — this shapes everything)
A tutor turn takes ~15s (unlock judge → teacher draft → gate → maybe redraft →
re-gate, each a CLI LLM call). The user stares at static "thinking" dots.

**HARD CONSTRAINT: you must NOT stream the teacher's reply tokens to the client.**
The gate must vet the complete draft before the student sees one character —
otherwise a leaked answer streams out before it's caught. "Streaming" here means:

1. **Stage events** over SSE — the server tells the client which pipeline stage
   is running ("drafting", "gate-checking", "redrafting"), so the wait feels
   alive and honest.
2. **Typewriter reveal** of the final, gate-approved reply on the client.

Also inviolable: the answer key / card internals never reach the client. Do not
add any new response fields beyond what's specified below.

## Files to change (exactly these four)

### 1. `engine/src/session.ts`
Add a stage type and an optional callback param to `submit`:

```ts
export type TurnStage = 'unlock' | 'draft' | 'gate' | 'redraft';

async submit(studentMessage: string, onStage?: (stage: TurnStage) => void): Promise<TurnResult>
```

Emit points (order matters):
- `onStage?.('unlock')` — immediately before `judgeUnlock` (i.e., only when the
  prefilter decided the judge runs at all).
- `onStage?.('draft')` — before the first `teacherTurn`.
- `onStage?.('gate')` — before the first `gateCheck`.
- On REVISE: `onStage?.('redraft')` before the second `teacherTurn`, then
  `onStage?.('gate')` again before the second `gateCheck`.

No other engine changes. `submit(msg)` with no callback must behave exactly as
today (`engine/src/cli.ts` and tests call it that way — do not break them).
Export `TurnStage` from `engine/src/index.ts`.

### 2. `server/src/server.ts`
Convert `POST /api/session/:id/submit` into an **SSE response on the POST**
(the client reads it with `fetch` + a stream reader — deliberately NOT
`EventSource`, whose auto-reconnect would re-submit the turn).

- Keep the existing validations exactly as they are (404 unknown session, 400
  missing message) — those still respond with plain JSON via `sendJson`,
  since nothing has streamed yet.
- After validation passes, write the stream head:
  ```ts
  res.writeHead(200, {
    ...CORS,
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  ```
- Helper `sendEvent(res, event: string, data: unknown)` that writes
  `` `event: ${event}\ndata: ${JSON.stringify(data)}\n\n` ``.
- Call `session.submit(message, (stage) => sendEvent(res, 'stage', { stage }))`.
- On success: `sendEvent(res, 'result', { reply, mode, unlockedThisTurn, redrafted })`
  (same four fields as today, nothing more), then `res.end()`.
- On error thrown by submit: `sendEvent(res, 'error', { error: message })`,
  then `res.end()`. Do NOT let it fall through to the outer catch.
- The outer catch in `createServer` currently calls `sendJson` unconditionally;
  guard it with `if (!res.headersSent)` (and just `res.end()` otherwise) so a
  mid-stream failure can't crash on double headers.

### 3. `web/src/api.ts`
Replace `submitTurn` with a streaming version (same name is fine):

```ts
export type TurnStage = 'unlock' | 'draft' | 'gate' | 'redraft'

export async function submitTurn(
  sessionId: string,
  message: string,
  onStage?: (stage: TurnStage) => void,
): Promise<TurnResult>
```

Implementation: `fetch` POST as today; if `!res.ok` throw as today (validation
errors are still JSON). Otherwise read `res.body` with a reader +
`TextDecoder`, accumulate into a buffer, split SSE frames on `\n\n`, parse
`event:` / `data:` lines. `stage` events → `onStage?.(parsed.stage)`.
`result` event → resolve with the `TurnResult`. `error` event → throw
`new Error(parsed.error)`. Stream ending with no `result`/`error` → throw.
No new dependencies — hand-rolled parser, it's ~25 lines.

### 4. `web/src/App.tsx`
Two things: stage-aware thinking copy, and the typewriter reveal.

**Stage copy.** Add `const [stage, setStage] = useState<TurnStage | null>(null)`.
In `turn()`, pass an `onStage` callback that sets it; clear it in the
`finally`. Replace the static "thinking about your move…" text in the
`.thinking` row with copy keyed by stage (keep the dots; keep the lowercase
chalk voice — these exact strings):

| stage | copy |
| --- | --- |
| `null` (submitted, nothing yet) | `reading your move…` |
| `unlock` | `checking what you've earned…` |
| `draft` | `thinking about your move…` |
| `gate` | `making sure i'm not giving it away…` |
| `redraft` | `rewording — i almost said too much…` |

**Typewriter reveal.** When the result lands, the new tutor note's body text
reveals progressively instead of appearing at once:
- Add an optional `revealed?: boolean` style flag on `Note` or track "the last
  tutor note is revealing" — your choice, but keep it simple and local to
  App.tsx (a `RevealingText` child component with its own interval state is
  the clean shape).
- Reveal speed: ~3 characters per 16ms tick (≈180 chars/s) via
  `setInterval`/`requestAnimationFrame`; render `text.slice(0, n)` with a
  trailing `▍` caret while revealing (caret disappears when done).
- Clicking the revealing note completes it instantly.
- The `unlocked` ("✓ you've got it") line renders only after the reveal
  completes; the `who` row + mode/reworded badges render immediately.
- Keep the notes column pinned to the bottom while revealing (the existing
  scroll effect keys on `notes`/`busy` — make sure it also fires as the reveal
  grows, e.g. include the reveal counter in a scroll effect inside the child
  and call a `onGrow` prop, or simplest: scroll in the child's tick).

The `review()` flow goes through the same `turn()` — it should get all of this
for free. Don't touch `LoadingBoard` (ingest loading is a separate, fake-staged
thing; leave it).

## What NOT to do
- No teacher-token streaming (see top).
- No `EventSource`.
- No new npm dependencies in any package.
- No changes to `engine/src/cli.ts`, gate/teacher/unlock prompts, or trace
  format.
- Don't restyle anything beyond the thinking row + reveal; "The Board" design
  language stays as is.

## Verify before you report back
- `npx tsc --noEmit` (or the closest typecheck available) passes in `engine`,
  `server`, `web` — if a package has no tsconfig-driven check, at minimum
  `npx tsx --eval "import('./src/server.ts')"`-style load must not throw.
- Grep the server response for card fields: the ONLY payload fields on the
  wire from submit are `stage`, `reply`, `mode`, `unlockedThisTurn`,
  `redrafted`, `error`.

Do NOT start the dev servers or run live LLM turns — the supervisor does live
verification after review.

## Report back
Files changed, commands run, and residual risk. Note anything in the spec that
didn't match reality.
