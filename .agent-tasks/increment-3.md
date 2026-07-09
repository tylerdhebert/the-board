# TASK: Increment 3 — the three roles (teacher, gate, unlock judge)

Wire the prompt templates in `../prompts/` to the model. Each role loads its
template, fills slots from the card + session state, calls the LLM, and returns
a typed result. Do NOT write the prompt text — the templates already exist.

## Hard rules
- Work ONLY inside `engine/`. You may READ files under `../prompts/` (do not modify).
- Do NOT run any git write command. Do NOT add any npm dependency.
- `strict` stays on; `npm run typecheck` must pass with zero errors.
- Reuse existing modules: `./types.js`, `./llm.js` (`LLMClient`, `completeJson`),
  `./paths.js` (`PROMPTS_DIR`). Do NOT redefine those.

## Templates you will consume (read them to see exact slot names)
- `../prompts/teacher_tmpl.md` — slots: title, statement, constraints, brute_force,
  optimal, key_insight, underlying_primitive, ladder, traps, leak_terms, transcript.
- `../prompts/gate_tmpl.md` — slots: problem_title, optimal_approach, key_insight,
  leak_terms, mode, student_msg, draft.
- `../prompts/unlock_tmpl.md` — slots: leak_terms, prev_teacher, student_msg.

## Files to create

### 1. `engine/src/render.ts`
- `export function fillTemplate(tpl: string, vars: Record<string, string>): string`
  - Replace every `{{key}}` occurrence with `vars[key]`. After filling, if any
    `{{...}}` placeholder remains, throw an Error naming the first missing key
    (this catches slot mismatches early).
- `export function bullets(items: string[]): string`
  - Join as `- item` lines. If `items` is empty, return `"(none)"`.
- `export function renderTranscript(messages: Message[]): string`
  - One line per message: `STUDENT: <content>` or `TEACHER: <content>`.
    If empty, return `"(no messages yet)"`.

### 2. `engine/src/teacher.ts`
```ts
export interface TeacherReply { mode: TutorMode; reply: string; raw: string }
export async function teacherTurn(
  client: LLMClient, card: ProblemCard, transcript: Message[],
  lockedTerms: string[], model: string,
): Promise<TeacherReply>
```
- Load `teacher_tmpl.md`. Fill slots:
  - title, statement, constraints, key_insight, underlying_primitive from the card.
  - brute_force = `${card.brute_force.approach} (${card.brute_force.time}, ${card.brute_force.space})`
  - optimal = `${card.optimal.approach} (${card.optimal.time}, ${card.optimal.space})`
  - ladder = `card.ladder.join(' -> ')`
  - traps = bullets of, for each trap: `${wrong_approach} — ${why_wrong}` and, if
    `counterexample` is non-empty, append ` (e.g. ${counterexample})`.
  - leak_terms = `bullets(lockedTerms)`
  - transcript = `renderTranscript(transcript)`
- Call `client.complete({ model, prompt })`. Let `raw` = the returned text.
- Parse the mode: if the first non-empty line matches `/^MODE:\s*(socratic|analog|scaffold)\b/i`,
  set `mode` to that (lowercased) and set `reply` to everything after that line,
  with leading blank lines trimmed. Otherwise `mode = 'socratic'` and `reply = raw.trim()`.
- Return `{ mode, reply, raw }`.

### 3. `engine/src/gate.ts`
```ts
export async function gateCheck(
  client: LLMClient, card: ProblemCard, mode: TutorMode,
  studentMsg: string, draft: string, lockedTerms: string[], model: string,
): Promise<GateVerdict>
```
- Load `gate_tmpl.md`. Fill: problem_title = card.title, optimal_approach =
  card.optimal.approach, key_insight = card.key_insight, leak_terms =
  bullets(lockedTerms), mode, student_msg = studentMsg, draft.
- `return await completeJson<GateVerdict>(client, { model, prompt })`.
- Defensive: if `parsed.verdict` is neither 'PASS' nor 'REVISE', throw an Error
  including the raw-ish parsed value.

### 4. `engine/src/unlockJudge.ts`
```ts
export interface UnlockResult { unlocked: string[]; reason: string }
export async function judgeUnlock(
  client: LLMClient, lockedTerms: string[], prevTeacher: string,
  studentMsg: string, model: string,
): Promise<UnlockResult>
```
- If `lockedTerms` is empty, return `{ unlocked: [], reason: 'no locked terms' }`
  WITHOUT calling the model.
- Load `unlock_tmpl.md`. Fill: leak_terms = bullets(lockedTerms), prev_teacher =
  prevTeacher, student_msg = studentMsg.
- `completeJson<UnlockResult>`. Then SANITIZE: keep only returned `unlocked`
  entries that are actually present in `lockedTerms` (drop anything the model
  invented). Return the sanitized result (preserve `reason`).

### 5. Update `engine/src/index.ts`
Re-export the new modules (`./render.js`, `./teacher.js`, `./gate.js`, `./unlockJudge.js`).

## Verification (run and report exact outputs)
1. `npm run typecheck` — zero errors.
2. Throwaway probe `engine/_probe.ts` (delete after), run with `npx tsx _probe.ts`
   from `engine/`. It should, using `CodexCliClient`, load `../cards/two_sum.card.json`:
   - teacherTurn with transcript `[{role:'student', content:'just started two sum, not sure where to begin'}]`,
     lockedTerms = card.leak_terms, model `gpt-5.5`. Print `mode` and the first ~120 chars of `reply`.
     (Expect mode socratic, a question that does not name the data structure.)
   - gateCheck mode 'socratic' on a LEAKY draft `'Use a hash map from value to index and look up target minus each number.'`
     with student_msg `'hint?'`, lockedTerms = card.leak_terms, model `gpt-5.4-mini`. Print verdict (expect REVISE).
   - gateCheck mode 'socratic' on a LEGIT draft `'For the current number, what single other value would complete the pair?'`
     Print verdict (expect PASS).
   - judgeUnlock: prevTeacher `'what could you keep track of as you scan?'`,
     studentMsg `'I could store each number I have seen along with its index as I go'`,
     lockedTerms = card.leak_terms, model `gpt-5.4-mini`. Print unlocked (expect at least one term).
   - judgeUnlock (fishing): studentMsg `'is the answer to use a hash map?'`. Print unlocked (expect empty []).
   Report the actual printed values. Then DELETE `engine/_probe.ts`.

## Report back (concise)
1. Files created/changed, one line each.
2. typecheck result and the probe outputs (all five printed values).
3. Residual risk or deviation.
