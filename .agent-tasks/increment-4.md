# TASK: Increment 4 — session orchestrator + headless CLI

Tie the roles into a running tutoring loop with deterministic leak-term
unlocking, a redraft-on-REVISE step, and a headless CLI to drive it. After this
increment the engine is a complete headless tutor a UI can sit on top of.

## Hard rules
- Work ONLY inside `engine/`. You may READ `../prompts/` and `../cards/`.
- Do NOT run any git write command. Do NOT add any npm dependency (Node builtins only).
- `strict` stays on; `npm run typecheck` must pass with zero errors.
- Reuse existing modules; do not duplicate logic. Import from `./types.js`,
  `./llm.js`, `./teacher.js`, `./gate.js`, `./unlockJudge.js`, `./render.js`, `./paths.js`.

## Step A — extend the teacher to accept gate feedback (redraft support)
The template `../prompts/teacher_tmpl.md` now has a `{{gate_feedback}}` slot
(currently unfilled). Update `engine/src/teacher.ts`:
- Add an OPTIONAL final parameter: `gateFeedback?: { rejectedDraft: string; note: string }`.
- Always fill the `gate_feedback` slot:
  - if `gateFeedback` is undefined → `''` (empty string).
  - else → a block like:
    `Your previous draft was REJECTED by the safety gate for: <note>\nRejected draft:\n<rejectedDraft>\nRewrite it to satisfy the gate (reveal LESS, or switch mode if that is the right move).`
- Everything else about `teacherTurn` stays the same. Confirm `npm run typecheck` still passes.

## Step B — `engine/src/session.ts`
```ts
export interface SessionModels { teacher: string; gate: string; unlock: string }
export interface TurnResult {
  mode: TutorMode;
  reply: string;            // final student-facing reply (MODE line already stripped)
  gate: GateVerdict;        // final gate verdict
  redrafted: boolean;       // whether a redraft happened
  unlockedThisTurn: string[];
}
export class TutorSession {
  constructor(client: LLMClient, card: ProblemCard, models: SessionModels);
  get transcript(): readonly Message[];
  get lockedTerms(): readonly string[];
  submit(studentMessage: string): Promise<TurnResult>;
}
```
Also export a helper (and unit-test it in the probe):
`export function shouldJudgeUnlock(studentMessage: string, lockedTerms: string[]): boolean`
- Return true iff the lowercased student message contains a whole word (length >= 4)
  that also appears as a whole word in any locked term (lowercased). Tokenize on
  non-alphanumeric characters. This is a cheap prefilter so the unlock judge is
  only called when the message plausibly touches a locked concept.

`TutorSession` internal state: the `card`, a mutable `transcript: Message[]`
(starts empty), and a mutable `lockedTerms: string[]` (starts as a copy of
`card.leak_terms`).

`submit(studentMessage)` does, in order:
1. Push `{ role: 'student', content: studentMessage }` to the transcript.
2. UNLOCK: if `shouldJudgeUnlock(studentMessage, lockedTerms)` is true AND
   lockedTerms is non-empty, call `judgeUnlock(client, lockedTerms, prevTeacher,
   studentMessage, models.unlock)` where `prevTeacher` is the content of the last
   teacher message in the transcript (or `''` if none). Remove every unlocked
   term from `lockedTerms` (in place). Record `unlockedThisTurn`. If the prefilter
   is false, `unlockedThisTurn = []` and no model call.
3. TEACHER: `const t = await teacherTurn(client, card, transcript, lockedTerms, models.teacher)`.
4. GATE: `let verdict = await gateCheck(client, card, t.mode, studentMessage, t.reply, lockedTerms, models.gate)`.
5. REDRAFT (at most once): if `verdict.verdict === 'REVISE'`, call `teacherTurn`
   again with the same args PLUS `gateFeedback = { rejectedDraft: t.reply, note: verdict.note }`.
   Replace mode/reply with the redraft, and re-run `gateCheck` to get the final
   verdict. Set `redrafted = true`. Do NOT redraft more than once (accept the
   second draft regardless of its verdict).
6. Push `{ role: 'teacher', content: <final reply> }` to the transcript.
7. Return `{ mode, reply, gate: verdict, redrafted, unlockedThisTurn }`.

`transcript` and `lockedTerms` getters must return read-only VIEWS (return copies
or `readonly` casts) so callers can't mutate internal state.

## Step C — `engine/src/cli.ts` (headless REPL)
- Reads a card path from `process.argv[2]`, defaulting to `../cards/two_sum.card.json`
  resolved relative to the repo root (use `paths.ts` REPO_ROOT). Load + JSON.parse it.
- Construct `new CodexCliClient()` and a `TutorSession` with models
  `{ teacher: 'gpt-5.5', gate: 'gpt-5.4-mini', unlock: 'gpt-5.4-mini' }`.
- Use `node:readline/promises` over stdin/stdout. Print a one-line banner with the
  problem title. Loop: prompt `you> `, read a line; if it is `exit`/`quit` or EOF, quit.
  Otherwise `await session.submit(line)` and print:
  - `tutor [<mode>]> <reply>`
  - if `unlockedThisTurn.length` : a dim line `(unlocked: term1, term2)`
  - if `redrafted` : a dim line `(gate made the tutor redraft)`
- Add an npm script to `engine/package.json`: `"cli": "tsx src/cli.ts"`.

## Step D — update `engine/src/index.ts`
Re-export `./session.js`.

## Verification (run and report exact outputs)
1. `npm run typecheck` — zero errors.
2. Throwaway NON-INTERACTIVE probe `engine/_probe.ts` (delete after), run with
   `npx tsx _probe.ts` from `engine/`, using `CodexCliClient` and the two_sum card:
   - First, unit-test `shouldJudgeUnlock`:
     - `shouldJudgeUnlock('is it a hash map?', ['store previously seen values by index'])` — print result.
     - `shouldJudgeUnlock('I will store each number I have seen', ['store previously seen values by index'])` — print (expect true).
   - Then create a `TutorSession` and drive these 3 student turns in sequence,
     printing for each: mode, the first ~100 chars of reply, unlockedThisTurn, redrafted:
     1. `"just started, not sure where to begin"`
     2. `"I'd loop over every pair and check if they sum to target"`
     3. `"I could store each number I've seen with its index as I go, then check for the complement"`
   - After turn 3, print `session.lockedTerms` (expect it to have SHRUNK vs the
     card's original leak_terms, because turn 3 commits to the stored-values idea).
   Report the actual printed output. Then DELETE `engine/_probe.ts`.

## Report back (concise)
1. Files created/changed, one line each.
2. typecheck result and the full probe output.
3. Residual risk or deviation. In particular, confirm whether lockedTerms
   actually shrank after turn 3 (the deterministic unlock working end-to-end).
