# TASK: Increment 6 — per-turn interaction trace log (JSONL)

Capture EVERY model interaction per turn and persist it as JSONL, so prompts can
be tuned and bad turns debugged. The data already flows through the roles and the
session; today it is discarded. Thread it out without changing existing behavior.

## Hard rules
- Work ONLY inside `engine/`. Do NOT run any git write command. No new npm deps.
- `strict` stays on; `npm run typecheck` must pass with zero errors.
- BACKWARD COMPATIBLE: existing callers of `teacherTurn`/`gateCheck`/`judgeUnlock`
  and `new TutorSession(client, card, models)` must keep working unchanged. New
  parameters are OPTIONAL with safe defaults.
- Reuse existing modules; import types from `./types.js`, `./llm.js`, etc.

## Step A — add an optional `label` to LLM requests
In `engine/src/llm.ts`, add an OPTIONAL field to `LLMRequest`:
`label?: string`  // e.g. 'teacher' | 'gate' | 'unlock' — used only for tracing.
`CodexCliClient` ignores it (does not pass it to codex). No other change to llm.ts.

Then set the label on each role's request:
- `teacher.ts`: the `client.complete({...})` call gets `label: 'teacher'`.
- `gate.ts`: the `completeJson(...)` request gets `label: 'gate'`.
- `unlockJudge.ts`: the `completeJson(...)` request gets `label: 'unlock'`.

## Step B — `engine/src/trace.ts`
```ts
import type { GateVerdict, TutorMode } from './types.js';
import type { LLMClient, LLMRequest } from './llm.js';

export interface LLMCallTrace {
  label: string; model: string; ms: number;
  promptChars: number; outputChars: number;
  prompt: string; output: string;
}
export interface TurnTrace {
  turn: number; ts: string; studentMsg: string;
  lockedBefore: string[]; lockedAfter: string[]; unlocked: string[];
  redrafted: boolean; finalMode: TutorMode; finalReply: string; finalVerdict: GateVerdict;
  calls: LLMCallTrace[];
}
export interface Tracer {
  recordCall(call: LLMCallTrace): void;
  endTurn(meta: Omit<TurnTrace, 'calls'>): Promise<void>;
}
```
- `export class NullTracer implements Tracer` — both methods no-op (`endTurn` returns a resolved promise). Default tracer.
- `export class JsonlTracer implements Tracer` — constructor takes `filePath: string`.
  - Holds a private buffer of `LLMCallTrace[]` for the CURRENT turn. `recordCall`
    pushes to it. `endTurn(meta)` builds `{ ...meta, calls: buffer }`, appends it
    to `filePath` as ONE line (`JSON.stringify(trace) + '\n'`, utf-8, create/append,
    use `appendFile`), then CLEARS the buffer.
- `export class TracingLLMClient implements LLMClient` — constructor `(inner: LLMClient, tracer: Tracer)`.
  - `complete(req)`: record `Date.now()` before, call `inner.complete(req)`, compute
    `ms`. Call `tracer.recordCall({ label: req.label ?? 'unknown', model: req.model,
    ms, promptChars: req.prompt.length, outputChars: output.length, prompt: req.prompt,
    output })`. Return the output. (If `inner.complete` throws, let it propagate — do
    not record a partial call.)

## Step C — wire the tracer into `engine/src/session.ts`
- `TutorSession` constructor gains an OPTIONAL 4th param `tracer: Tracer = new NullTracer()`.
- Internally wrap the client: `this.client = new TracingLLMClient(client, tracer)`;
  keep a reference `this.tracer = tracer`. All role calls already go through `this.client`,
  so they are now traced automatically.
- Add a private turn counter starting at 0; increment at the start of each `submit`.
- In `submit`, capture `lockedBefore = [...this._lockedTerms]` at the very START
  (before the unlock step). After the loop, before returning, call:
  `await this.tracer.endTurn({ turn, ts: new Date().toISOString(), studentMsg,
    lockedBefore, lockedAfter: [...this._lockedTerms], unlocked: unlockedThisTurn,
    redrafted, finalMode: t.mode, finalReply: t.reply, finalVerdict: verdict })`.
- Behavior with the default `NullTracer` must be identical to today.

## Step D — `engine/src/cli.ts`: write a session log
- Before constructing the session, create a `JsonlTracer` writing to
  `<REPO_ROOT>/logs/session-<timestamp>.jsonl` (use `paths.ts` REPO_ROOT; make the
  `logs` dir with `mkdir({recursive:true})`; timestamp = `new Date().toISOString().replace(/[:.]/g,'-')`).
  Pass it as the 4th `TutorSession` arg. Print `(logging to <path>)` in the banner.

## Step E — update `engine/src/index.ts` to re-export `./trace.js`.

## Verification (run and report exact outputs)
1. `npm run typecheck` — zero errors.
2. Throwaway probe `engine/_probe.ts` (delete after), `npx tsx _probe.ts` from `engine/`,
   using `CodexCliClient`, the two_sum card, and a `JsonlTracer` pointed at a temp file
   (e.g. `os.tmpdir()`/`trace-test.jsonl`). Drive TWO student turns:
   `"not sure where to start"` then `"i'd check every pair, it's O(n^2)"`.
   Then READ the temp file and print:
   - number of lines (expect 2)
   - for each line: `turn`, `calls.length`, the list of `calls[].label`, `redrafted`,
     and `lockedBefore.length`/`lockedAfter.length`.
   Expect each turn to have at least a 'teacher' and a 'gate' call. Delete the temp file
   and `engine/_probe.ts` after. Report the printed values.
3. Confirm the default path is untouched: state that `new TutorSession(client, card, models)`
   (no tracer) still typechecks and behaves as before (NullTracer).

## Report back (concise)
1. Files created/changed, one line each.
2. typecheck result and the probe output (2 lines, calls + labels per turn).
3. Residual risk or deviation.
