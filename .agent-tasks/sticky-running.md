# Fix: sticky "running…" state after a run error (Round A-a)

## Diagnosis (already done — do not re-derive)

The reported bug: a run that times out (infinite loop) can leave the run
button stuck on "running…" forever, even after an error is visible.

Everything settles correctly on the *happy* timeout path (verified live at
every layer: engine direct, API direct, via the vite proxy, and in a real
browser UI). The client's `runTheExamples` resets `running` in a `finally`,
so the ONLY way the button sticks is a fetch that never settles — i.e. the
server never responds. The server can hang exactly one way: every child
runner (`runChild` in `engine/src/runStudentCode.ts`, `runCli` in
`engine/src/llm.ts`, the inline runners in `engine/src/exampleCases.ts` and
`engine/src/ingest.ts`) settles its promise ONLY in the child's `'close'`
event. `'close'` fires when the stdio pipes close, not when the process
exits. After a timeout kill (`killTree` → `taskkill /T /F`), a kill-race
survivor — an orphaned grandchild that inherited the stdio handles (orphaned
`esbuild.exe` from a killed tsx was observed live; codex is a 3-deep chain) —
keeps the pipes open forever, so `'close'` never fires, the promise never
settles, the endpoint never responds, and the button sticks. This is also the
exact mechanism of the documented "/api/start hung forever" codex-stall
incident: the llm.ts watchdog kills the tree but then still waits on
`'close'`.

Fix both sides: force-settle server-side after a kill, and cap the run fetch
client-side so no future server hang can ever wedge the button again.

## Changes (5 files, all small)

### 1. `engine/src/runStudentCode.ts` — `runChild`

Add a `settled` flag and a `settle(exitCode)` helper that resolves with the
accumulated stdout/stderr, guarded by `settled`. In the timeout timer, after
`killTree`/`child.kill()`, schedule a grace timer:

```ts
setTimeout(() => settle(null), KILL_GRACE_MS).unref();
```

with a module const `const KILL_GRACE_MS = 5_000;` next to the other
`*_TIMEOUT_MS` consts, commented:

```ts
// After a timeout kill, how long to keep waiting for 'close' before settling
// anyway (a kill-race orphan can hold the stdio pipes open forever).
```

The `'close'` handler calls `settle(exitCode)`; the `'error'` handler guards
`reject` with the same `settled` flag. `.unref()` on the grace timer matters
(don't keep the process alive for it). Note `killed = true` is set before the
grace timer, so a grace-settled result has `timedOut: true` and flows through
the existing `parseHarness` timeout branch — no result-shape changes.

Put a short comment on the grace timer at each site, e.g.:

```ts
// 'close' waits for the stdio pipes, and a kill-race survivor (an orphaned
// grandchild holding the inherited handles) can keep them open forever —
// after the kill, stop waiting for it.
```

### 2. `engine/src/llm.ts` — `runCli`

Same hazard: the inactivity watchdog kills the tree but resolution waits on
`'close'`. Add `let settled = false;` and a `fail(err)` helper (guarded
reject). Inside the watchdog callback, after `killTree`, schedule
`setTimeout(() => fail(new Error(...)), KILL_GRACE_MS).unref()` using the
SAME message the `'close'` handler uses for the timed-out case
("<command> produced no output for Ns and was killed (stalled stream?) — try
again"). Guard the `'close'` handler with `settled` (return early if already
settled; otherwise set it and resolve/reject as today) and route its
timed-out reject through `fail`. `'error'` handler uses `fail` too. Add
`const KILL_GRACE_MS = 5_000;` below `CLI_INACTIVITY_MS` with the same
two-line comment as above.

### 3. `engine/src/exampleCases.ts` — inline runner in `extractCases`

Identical treatment to runChild: `settled` flag + `settle(exitCode)` helper,
grace timer after the kill in the timeout callback, guards on `'error'` and
`'close'`. Add `const KILL_GRACE_MS = 5_000;` below `EXTRACT_TIMEOUT_MS`.
A grace-settled run has `timedOut: true` → existing "extractCases timed out"
throw path handles it.

### 4. `engine/src/ingest.ts` — inline runner in `verifyCard`

Same pattern once more (this one uses plain `child.kill()`, keep that). The
timeout const is function-local (`VERIFY_TIMEOUT_MS`), so just use a literal
`5_000` in the grace timer with the same comment, no new module const.

### 5. `web/src/api.ts` — client-side hard cap + real error messages

(a) In `request<T>()`, when `!res.ok`, try to parse the body as JSON and use
its `error` field as the thrown message, falling back to the current
`Request failed: <status>` when absent/unparseable. (The /run error path
sends `{ cases: [], error }` with status 500 — today the UI shows a useless
"Request failed: 500" and drops the real message.)

(b) In `runExamples`, pass `signal: AbortSignal.timeout(RUN_FETCH_TIMEOUT_MS)`
through to the fetch (the `request` helper spreads `init`, so just add it to
the init object) with a module const:

```ts
// Hard client-side cap on a run: the slowest legit path (first csharp run =
// compile + 60s case timeout, plus case re-extraction on a resumed session)
// stays well under this. If the server never answers (hung child, wedged
// socket), the fetch aborts so the run button can't stay stuck on "running…".
const RUN_FETCH_TIMEOUT_MS = 120_000
```

Catch the abort in `runExamples` and rethrow it as a friendly error, e.g.:

```ts
if (err instanceof DOMException && err.name === 'TimeoutError') {
  throw new Error(
    `the run never came back after ${RUN_FETCH_TIMEOUT_MS / 1000}s — gave up waiting (is the api server stuck?)`,
  )
}
```

The App's existing catch → `setError` → banner then shows it, and `finally`
frees the button.

## Do NOT touch

- `web/src/App.tsx` and `web/src/index.css` have the USER'S uncommitted
  prototype changes — leave both files completely alone.
- No behavior changes to the happy paths; result shapes stay identical.
- No new dependencies.

## Verify

- `npx tsc --noEmit` clean in both `engine/` and `web/` (run each from its
  own package dir).
- Do NOT start servers or run the app; the orchestrator verifies live
  behavior separately.

## Report back

Files changed, commands run, residual risk.
