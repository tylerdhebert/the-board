# Round C minimal: cached tougher cases with a reference oracle

Implement the final minimal Round C design from `HANDOFF.md`.

An LLM proposes adversarial input calls only. Expected outputs come only from executing the verified Python reference. Tougher cases are cached on the card, run alongside official examples, visually distinct, counted separately, and never participate in solved gating.

Exactly two passive product rules:

1. `solved` is determined by official examples only.
2. Tougher-case rows are visually distinct and counted separately.

Do not add dispute/delete controls, oracle voting, brute-force generation, constraint-validator generation, or any new settings/provider role. Chat is the dispute mechanism.

## Subagent ground rules

- Do not run the `tyler-review` skill or launch any auxiliary reviewer.
- Preserve all existing dirty Round A, Python LSP, and Round B work.
- Never use real `tutor.db`, logs, cards, or live ports as fixtures. Use temp files/dirs and isolated processes.
- Never kill processes by name. Kill only PIDs you start.
- Do not commit.

## Card and result types

- Extend `ProblemCard` with optional `stress?: Example[]`, where each cached row is the same `{ input, output }` shape as official examples.
- Keep ingest schema compatibility: new cards may omit `stress`; do not ask the ingest prompt to generate it.
- Extend engine `CaseSpec` and `RunCaseResult` with optional `stress?: boolean`.
- `extractCases` should accept a stress marker or otherwise provide a direct, simple way to tag extracted stress cases; `runStudentCode` must carry that marker onto each result row.
- Persisted takes need no schema migration because results are JSON.

## Stress generation engine

Add one focused engine module and prompt for generating tougher cases.

- Input: LLM client/model + a verified `ProblemCard`.
- Prompt includes title, statement, constraints, the official example input calls, and the required reference entrypoint name. Ask for 4-6 adversarial call expressions that target boundaries, duplicates, sign/zero behavior, minimal/maximal shapes, or common wrong approaches relevant to this problem.
- Output JSON contains input strings only. Do not ask the LLM for outputs, expected answers, implementations, validators, or explanations.
- Validate the returned shape manually and cap it to 6 strings.
- Reject duplicates of official examples and duplicate proposals.
- Before execution, accept only a Python call expression to the same reference entrypoint with literal positional/keyword arguments. Use Python AST/literal parsing; do not `eval` arbitrary proposed expressions.
- For each accepted input, execute the card's Python reference to derive the actual output. Run proposals independently with a short timeout (about 5 seconds each) so one looping/bad case is cheap to kill and drop. Reuse the repo's guarded child-process patterns (`killTree`, close grace); never broad-kill.
- A proposal that raises, times out, cannot serialize to a Python literal/JSON-safe value, or fails shape validation is dropped.
- Store the oracle output as a Python literal string accepted by existing `extractCases` (`repr` is fine for supported literal values).
- Return only valid `{input, output}` rows. Require at least one valid row or surface a useful generation error; do not cache an empty success.
- The reference language must be Python, matching current ingest verification. Surface a clear unsupported-language error otherwise.

Keep this implementation minimal. Do not build a generalized sandbox/oracle framework.

## Card persistence and endpoint

- Add a safe `saveCard(name, card)` beside `loadCard`, using the existing card-name validation and UTF-8 formatted JSON write.
- Add `POST /api/session/:id/stress`.
- If `entry.card.stress` already contains rows, return the cached count immediately without another LLM call.
- Otherwise use the currently configured `ingest` backend/model to generate the rows, assign `entry.card.stress`, persist the card, invalidate the entry's extracted case cache, and return `{ count }`.
- Do not mutate session/take/solved state merely by generating cases.
- Concurrent double-clicks must not launch duplicate generation for one session; a small per-session in-flight promise/map is enough, or disable + server guard with the simplest ownership.
- Errors are ordinary JSON errors with useful messages.

## Student-safe API

- Extend the student-safe problem payload with only `stressCount: number`; never send the private answer key or raw cached oracle rows.
- All create/start/resume flows receive `stressCount`, defaulting to 0.
- Add a web API helper for the stress endpoint.

## Running cases and solved gating

- On `/run`, extract official cases with `stress: false`, append cached stress cases with `stress: true`, and run the combined list.
- Official examples remain first and tougher cases follow.
- Server solved persistence considers only official result rows (`!case.stress`) and requires at least one official row, no run error, and all official rows passing. Stress failures never unset or block solved.
- Update every client-side solved/all-pass helper to use official rows only.
- Round B's `BOARD: x/y passing` line also counts official rows only; its `last failing case` should prefer an official failure, then a stress failure only when official rows pass. Keep the line compact.

## UI

- Add a compact chalk action near the existing run/language controls with literal label `chalk up tougher cases` when `stressCount === 0`.
- While generating, show `chalking…` and disable repeat activation. After success, replace it with a terse non-button count such as `N tougher`.
- Do not add helper text, tooltips explaining the feature, a modal, hero content, or new settings.
- Running remains one action and returns one persisted take.
- In the selected take's results, render two small groups: official examples and tougher cases. Tougher rows must be visually distinct using the existing chalk palette, without rounded cards.
- Count official and tougher rows separately in the attempts rail score. Keep it compact (for example `3/3 · 2/3 tough`). Old takes without stress markers are all official.
- If stress cases were generated after an old run, that old run simply has no tougher group.

## Scope constraints

- No LeetCode authenticated custom-input endpoint.
- No brute-force cross-provider implementation.
- No generated input-constraint validator.
- No dispute, delete, retry-per-case, accept, ignore, or override controls.
- No database schema change or new npm dependency.
- No changes to tutor modes, gate/unlock, provider settings shape, or editor/LSP behavior.

## Verification

- Run engine/server TypeScript checks and `bun run build` in `web/`.
- Run a focused isolated engine check with a fake LLM and temp-safe child execution proving:
  - LLM output contains inputs only;
  - invalid/mismatched/nonliteral/duplicate proposals are dropped;
  - reference execution supplies cached outputs;
  - a throwing proposal is dropped without losing good rows;
  - returned stress cases carry `stress: true` through the student runner.
- Run a focused solved-gating check proving: official all-pass + stress fail => solved; official fail + stress pass => not solved.
- Verify student-safe payload exposes count only, not raw stress rows or answer-key fields.
- Remove temporary check scripts after running them.

## Report back

Return files changed, commands and concise outputs, focused verification evidence, and residual risk.
