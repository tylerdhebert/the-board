# Mutation/in-place grading — warts.md #4

Greenlit by the user 2026-07-11. Goal: problems whose solutions mutate an
argument instead of returning a value (Rotate Array, Sort Colors, Move
Zeroes, Merge Sorted Array…) and the "return k + first k elements"
family (Remove Duplicates, Remove Element) must ingest, verify, and grade
correctly. Today they fail at BOTH ends: `verifyCard`/the stress oracle
compare the reference solution's return value (None for void solutions),
and the student harnesses answer "got nothing back — did you return the
result?" (`engine/src/runStudentCode.ts:236`).

Files: `engine/src/leetcode.ts`, `engine/src/types.ts`,
`engine/src/ingest.ts`, `engine/src/exampleCases.ts`,
`engine/src/runStudentCode.ts`, `engine/src/stressCases.ts`,
`server/src/engine.ts`, `server/src/server.ts` (call sites only).
NO changes to prompts/, the card JSON schema, or web/.

## The idea

A `judge` descriptor, detected once at ingest from LeetCode `metaData`,
rides on the card and tells every runner how to extract "got":

```ts
// engine/src/types.ts
export type Judge =
  | { kind: 'in-place'; argIndex: number }   // got = args[argIndex] after the call
  | { kind: 'k-prefix'; argIndex: number };  // got = { k: ret, prefix: args[argIndex][0..k) }
// ProblemCard gains: judge?: Judge
```

`judge` absent = today's return-value grading. Old seed/persisted cards
have no `judge`, so nothing changes for them.

## 1. Detect at fetch (engine/src/leetcode.ts)

- Add `metaData` to the GraphQL field list (`engine/src/leetcode.ts:64`).
  It is a JSON **string**, e.g.
  `{"name":"rotate","params":[{"name":"nums","type":"integer[]"},{"name":"k","type":"integer"}],"return":{"type":"void"}}`.
  Parse defensively — missing/unparseable metaData ⇒ `judge` undefined.
- `return.type === "void"` ⇒ `{ kind: 'in-place', argIndex }` where
  argIndex = first param whose type ends in `[]` (fallback 0).
- `return.type === "integer"` AND at least one array param AND at least
  one example output matching `/^\s*\d+\s*,\s*\w+\s*=\s*\[/` (the
  `2, nums = [1,2,_]` shape) ⇒ `{ kind: 'k-prefix', argIndex }`.
  Example outputs are not visible inside `fetchProblem` — export the
  detection as a function that takes metaData + examples and call it at
  the seam in `server/src/engine.ts` (~line 109) where `fetchProblem`
  meets `ingest`. Whatever split is cleanest, detection logic lives in
  the engine, not the server.
- Expose `judge?: Judge` on `LeetCodeProblem` (or from the detection
  helper) and set `card.judge` BEFORE `verifyCard` runs. The card LLM
  never sees or produces `judge`.

## 2. Reference verification (engine/src/ingest.ts)

`buildVerifyScript` currently does `got = eval(inp, ns)`
(`engine/src/ingest.ts:53`). When `card.judge` is present the script must
instead: `ast.parse` the example input as a call, `literal_eval` the
args, invoke the entry point with them, then

- in-place: `got = args[argIndex]`
- k-prefix: `got = [ret] + args[argIndex][:ret]`… no — represent as
  `{"k": ret, "prefix": args[argIndex][:ret]}` and compare against the
  parsed expected (see §3). Pass/fail logic stays in the script.

Expected side: in-place outputs literal_eval fine (they're plain lists).
k-prefix outputs are `"2, nums = [1,2,_]"` — parse k and the bracket
list, treat `_` entries as "don't care" (they pad past k anyway; drop
them). Keep the existing sorted-list leniency for in-place lists whose
problem says "any order" — i.e. reuse the current `==` or `sorted(...)`
check on the mutated list.

## 3. Case extraction (engine/src/exampleCases.ts)

`extractCases` `literal_eval`s the output — k-prefix outputs blow up
there today. Give it the judge (new optional param). For k-prefix,
parse `"k, name = [...]"` into
`expected = { "k": <int>, "prefix": [<first k entries, '_' dropped>] }`.
In-place needs no change (outputs are plain literals).

## 4. Student harnesses (engine/src/runStudentCode.ts)

`runStudentCode(code, language, cases, scaffold?, judge?)`. All three
harnesses (python `engine/src/runStudentCode.ts:252`, ts/js `:294`,
csharp `:319`):

- in-place: after the call, `got = args[argIndex]`; the return value is
  ignored. The `engine/src/runStudentCode.ts:229` null-got branch and its
  "did you return the result?" message must NOT fire for judged cases.
- k-prefix: `got = { k: <returned int>, prefix: args[argIndex].slice(0, k) }`
  (guard k out of range ⇒ error string, not a crash).
- C#: `args[i]` after `method.Invoke` already holds the mutated
  deserialized array — serialize that.
- `compareGot`: for k-prefix compare k strictly and the prefix with the
  existing `deepEqual` (its any-order fallback covers "any order"
  problems). In-place needs no comparator change (expected is the list).

Update the `runStudentCode` call sites in `server/src/server.ts` (and the
`extractCases` calls at `server/src/server.ts:332`/`336`) to pass
`card.judge`.

## 5. Stress oracle (engine/src/stressCases.ts)

`buildOracleScript` (`engine/src/stressCases.ts:108`) evaluates `callSrc`
and emits the return value. When judge is present, bind args / call /
emit the mutated arg (in-place) or `"k, nums = [...]"`-formatted string
(k-prefix) so the cached stress Example rows stay symmetric with
official-example parsing in §3. Stress rows must round-trip: whatever
the oracle writes, `extractCases` + the harness comparison must grade.

## Do NOT

- No prompt or card-schema changes; the card LLM never produces `judge`.
- No UI changes.
- Don't alter grading for cards without `judge` — byte-for-byte same
  behavior, including error messages.
- Don't touch gate/teacher/session code.

## Verify

- `npx tsc --noEmit` clean in `engine/` and `server/`.
- Add `.agent-tasks/checks/mutation-grade.mjs` (runnable with plain
  `node`, imports built or tsx-loaded engine sources the same way
  `.agent-tasks/checks/point-parse.mjs` does) covering at least:
  1. python Rotate Array, correct in-place solution, judge in-place ⇒ all pass;
  2. same problem, wrong rotation ⇒ fail (not "got nothing back");
  3. typescript Move Zeroes in-place ⇒ pass;
  4. python Remove Duplicates (k-prefix) correct ⇒ pass, and an
     incorrect k ⇒ fail;
  5. a judge-less card (two-sum style) ⇒ unchanged behavior.
  Run it and paste the output.

## Report back

Files changed, commands run, check output, residual risk — explicitly
including anything you had to cut or reinterpret from this spec.
