# TASK: Increment 2 — ingest (statement → verified problem card)

Build the ingest module: turn a problem statement into a `ProblemCard`, then
VERIFY it by executing the card's reference solution against its own examples.

## Hard rules
- Work ONLY inside `engine/`. Do NOT touch files outside `engine/` EXCEPT you may
  READ `../schema.json` and `../prompts/ingest_prompt.md` (do not modify them).
- Do NOT run `git commit`, `git add`, or any git write command.
- Do NOT add any npm dependency. Use only Node built-ins and the existing types.
- TypeScript `strict` stays on. `npm run typecheck` must pass with zero errors.
- Reuse existing code: import types from `./types.js`, the client + helpers from
  `./llm.js`. Do NOT redefine `ProblemCard` or re-implement `completeJson`.

## Files to create

### 1. `engine/src/paths.ts`
Resolve repo-root asset paths from `import.meta.url` (this file is at
`engine/src/`, so the repo root is two directories up). Export:
- `export const REPO_ROOT: string` — absolute path to the repo root.
- `export const SCHEMA_PATH: string` — `<REPO_ROOT>/schema.json`
- `export const PROMPTS_DIR: string` — `<REPO_ROOT>/prompts`
Use `node:url` `fileURLToPath` and `node:path`. These must be absolute paths
that work regardless of the process CWD.

### 2. `engine/src/ingest.ts`

```ts
export interface VerificationResult {
  ok: boolean;
  cases: { input: string; expected: string; got: string; pass: boolean }[];
  error?: string; // set if the reference code failed to run at all
}
export interface IngestResult { card: ProblemCard; verification: VerificationResult }
```

Functions:

- `export async function generateCard(client: LLMClient, statement: string, model: string): Promise<ProblemCard>`
  - Read `PROMPTS_DIR/ingest_prompt.md` (utf-8).
  - prompt = ingest_prompt + `"\n\n## PROBLEM STATEMENT\n"` + statement.
  - Return `await completeJson<ProblemCard>(client, { model, prompt, outputSchemaPath: SCHEMA_PATH })`.

- `export async function verifyCard(card: ProblemCard): Promise<VerificationResult>`
  - Only Python reference code is supported. If `card.optimal.language` does not
    contain "python" (case-insensitive), return `{ ok: false, cases: [], error: "unsupported language: <language>" }`.
  - Otherwise verify BY EXECUTION using a Python child process (`spawn('python', ['-'])`,
    env spread `process.env` + `PYTHONUTF8: '1'`, write the script to stdin):
    - The script must: `exec` the card's `optimal.code`, then for EACH example
      compute `got = eval(example.input)` and compare to `expected = ast.literal_eval(example.output)`.
      A case passes if `got == expected` OR (both are lists and `sorted(got) == sorted(expected)`).
    - The script prints ONE json line to stdout: `{"cases":[{"input","expected","got","pass"}], "error": null}`.
      If exec of the reference code raises, print `{"cases":[], "error":"<message>"}` and exit.
    - Build the script by embedding the card fields as a JSON blob the Python reads
      from a second stdin channel is NOT available — instead, pass the card's code
      and examples to Python by writing a small self-contained script that has the
      code and an examples list literal injected. Inject safely: `json.dumps` the
      code string and the examples on the Node side and embed those JSON literals
      into the Python source (Python can `json.loads` them). Do NOT naively string
      concatenate the raw code.
  - Parse the single JSON line from Python stdout. `ok` = (error is null AND every case passed).
  - On Python non-zero exit or unparseable output, return `{ ok:false, cases:[], error: <stderr or parse message> }`.

- `export async function ingest(client: LLMClient, statement: string, model: string): Promise<IngestResult>`
  - `card = await generateCard(...)`; `verification = await verifyCard(card)`; return `{ card, verification }`.

## Verification (you MUST run this and report the exact output)
1. `npm run typecheck` — zero errors.
2. Write a TEMPORARY throwaway script `engine/_probe.ts` (you will delete it after)
   that does the following and run it with `npx tsx engine/_probe.ts` from the repo
   root (or `npx tsx _probe.ts` from engine/):
   - import `verifyCard` and `ProblemCard`.
   - `JSON.parse` the file `../cards/two_sum.card.json` as a `ProblemCard`.
   - call `verifyCard(card)` and `console.log` the result.
   - EXPECTED: `ok: true` with 3 passing cases (the two_sum reference passes its examples).
   Report the actual printed output. Then DELETE `engine/_probe.ts`.
   (Do NOT call generateCard in the probe — that costs a model call; verifyCard is
   the part that needs proving.)

## Report back (concise)
1. Files created + one line each.
2. typecheck result, and the `verifyCard` probe output (must show ok:true, 3 cases).
3. Residual risk or any deviation. In particular call out the code-execution
   safety consideration (verifyCard runs model-generated Python).
