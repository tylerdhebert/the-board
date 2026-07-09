# TASK: Increment 7 — provider abstraction + per-role backend selection

Let each role (teacher / gate / unlock) run on a DIFFERENT backend, so a lapsed
subscription can be swapped out per role. Add a second CLI adapter (`claude`) to
prove cross-backend routing. Keep one typed adapter per backend — NOT a shared
CLI-output parser.

## Hard rules
- Work ONLY inside `engine/`. Do NOT run any git write command. No new npm deps.
- `strict` stays on; `npm run typecheck` must pass with zero errors.
- This increment INTENTIONALLY changes the `SessionModels` shape and the
  `TutorSession` constructor. Update every caller in the repo (`cli.ts`,
  `probes/deescalation.ts`) so the whole engine still typechecks and runs.

## Step A — second adapter: `ClaudeCliClient` in `engine/src/llm.ts`
Add alongside `CodexCliClient` (same `LLMClient` interface):
- `spawn('claude', args)` where args = `['-p', '--output-format', 'text']` and,
  ONLY IF `req.model` is a non-empty string, also `'--model', req.model`.
- Write `req.prompt` to stdin (utf-8), end stdin. Collect stdout. On close code 0,
  resolve stdout `.trim()`. On non-zero exit reject with an Error including stderr.
- Child env: spread `process.env`. (No tempfile — claude prints to stdout.)
- `req.outputSchemaPath` is ignored (claude text mode has no schema); that's fine.

## Step B — backend registry: `engine/src/providers.ts`
```ts
import type { LLMClient } from './llm.js';
export type BackendName = string; // 'codex' | 'claude' today; extensible
export function createClient(backend: BackendName): LLMClient
```
- `'codex'` -> `new CodexCliClient()`, `'claude'` -> `new ClaudeCliClient()`.
- Unknown backend -> throw `Error('unknown backend: <backend>')`.

## Step C — per-role backend in `engine/src/session.ts`
Change `SessionModels`:
```ts
export interface RoleConfig { backend: string; model: string }
export interface SessionModels { teacher: RoleConfig; gate: RoleConfig; unlock: RoleConfig }
```
Change the `TutorSession` constructor to:
```ts
constructor(
  card: ProblemCard,
  models: SessionModels,
  opts?: { tracer?: Tracer; createClient?: (backend: string) => LLMClient },
)
```
- No more `client` parameter. Resolve a client PER ROLE using
  `opts?.createClient ?? createClient` (the registry). Wrap EACH role's client in
  its own `TracingLLMClient(resolved, tracer)` sharing the single tracer
  (`opts?.tracer ?? new NullTracer()`), and store `teacherClient`, `gateClient`,
  `unlockClient`.
- In `submit`, call each role with ITS client and ITS model:
  - `judgeUnlock(this.unlockClient, ..., models.unlock.model)`
  - `teacherTurn(this.teacherClient, ..., models.teacher.model)` (and the redraft)
  - `gateCheck(this.gateClient, ..., models.gate.model)` (and the re-gate)
- The `opts.createClient` injection point is REQUIRED so tests can supply a mock
  client for all backends (return the same mock regardless of backend name).
- Everything else (unlock ordering, redraft-once, trace endTurn, read-only
  getters) stays exactly as it is.

## Step D — update callers
- `engine/src/cli.ts`: build default models as
  `{ teacher:{backend:'codex',model:'gpt-5.5'}, gate:{backend:'codex',model:'gpt-5.4-mini'}, unlock:{backend:'codex',model:'gpt-5.4-mini'} }`
  and construct `new TutorSession(card, models, { tracer })`. Behavior unchanged (all codex).
- `engine/probes/deescalation.ts`: update its `SessionModels` literal to the new
  shape (all `backend:'codex'`) and the constructor call to `new TutorSession(card, models, {})`.

## Step E — `engine/src/index.ts`: re-export `./providers.js`.

## Verification (run and report exact outputs)
1. `npm run typecheck` — zero errors.
2. Throwaway probe `engine/_probe.ts` (delete after), `npx tsx _probe.ts` from `engine/`:
   - Registry: print `createClient('codex').constructor.name`,
     `createClient('claude').constructor.name`, and that `createClient('bogus')` throws.
   - ClaudeCliClient smoke: `await new ClaudeCliClient().complete({ model:'', prompt:'Reply with exactly PONG.' })`
     — print the result (expect `PONG`).
   - CROSS-BACKEND session with a real tracer to a temp file: models =
     `{ teacher:{backend:'claude',model:''}, gate:{backend:'codex',model:'gpt-5.4-mini'}, unlock:{backend:'codex',model:'gpt-5.4-mini'} }`,
     two_sum card. Drive ONE turn `"not sure where to start"`. Print the returned
     `mode`, and read the trace file and print each `calls[].label` + `calls[].model`
     (expect the teacher call routed to claude, the gate call to codex). Delete temp file.
   - Delete `engine/_probe.ts`.
3. Confirm `npx tsx src/cli.ts` still starts (you may pipe `exit` into it).

## Report back (concise)
1. Files created/changed.
2. typecheck; the registry results; the claude PONG; the cross-backend trace
   (teacher->claude, gate->codex); CLI still starts.
3. Residual risk / deviation.
