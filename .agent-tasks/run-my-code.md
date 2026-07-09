# Increment: run my code — execute the student's buffer against the card's examples

## Why / shape
The tutoring loop is read → think → write → **check** → get nudged, and check
doesn't exist: the editor is write-only. This adds a "run the examples" button
that executes the STUDENT'S code against the card's examples and shows
pass/fail with got-vs-expected — and feeds the latest results into "review my
work" so the tutor aims at the actual failing case.

No answer-key leak: we run their code; examples are already visible in the
statement. Their code runs locally with a timeout (same trust level as the
app itself).

Supported languages THIS increment: **python, typescript, javascript, csharp**.
java/cpp/go: the run button is hidden (not disabled) for them.

## Ground truth about the data (verified — build on this)
- `card.examples` = `[{ input, output }]` where `input` is a PYTHON call
  expression string (`"two_sum([2, 7, 11, 15], 9)"`) and `output` a Python
  literal string (`"[0, 1]"`). Function name in `input` is the reference
  code's snake_case name — it does NOT match any scaffold's entry point.
- Scaffolds per language differ: python3 `class Solution: def reverse(self, x)`,
  typescript `function reverse(x: number)`, csharp
  `public class Solution { public int Reverse(int x) }`.
- Therefore: extract structured cases ONCE (args + expected as JSON), then
  per-language harnesses call the student's OWN entry point with those args.
- The repo has proven child-process patterns: `verifyCard` in
  `engine/src/ingest.ts` (python -, stdin script, 30s kill timer, last-stdout-
  line JSON) and `runCli` in `engine/src/llm.ts` (inactivity watchdog,
  killTree). REUSE these patterns; don't invent new ones.
- `server` has `tsx` as a devDependency (runs the TS harness); `dotnet` 9 SDK
  and `python` are on PATH.

## Engine

### 1. NEW `engine/src/exampleCases.ts`
`extractCases(examples: {input: string; output: string}[]): Promise<CaseSpec[]>`
where `CaseSpec = { display: string; args: unknown[]; expected: unknown }`.
Implementation: ONE python child (stdin script, verifyCard pattern, 10s cap)
that for each example: `ast.parse(input)` → the call node's `args` →
`ast.literal_eval` each → plus `ast.literal_eval(output)` → prints one JSON
line `[{args: [...], expected: ...}, ...]`. `display` = the original `input`
string. Python bools/None map to JSON true/false/null via json.dumps —
that's the point of doing it in python. Errors → throw with a readable
message.

### 2. NEW `engine/src/runStudentCode.ts`
```ts
export type RunCaseResult = { display: string; expected: string; got: string; pass: boolean; error?: string }
export type StudentRunResult = { cases: RunCaseResult[]; error?: string }
export async function runStudentCode(
  code: string,
  language: 'python' | 'typescript' | 'javascript' | 'csharp',
  cases: CaseSpec[],
  scaffold?: string,          // the LeetCode snippet for this language, for entry-point fallback
): Promise<StudentRunResult>
```
- **Entry-point detection** (regex on the student's code first, scaffold as
  fallback; no match → `{ cases: [], error: 'could not find your function' }`):
  - python: `def (\w+)\(self` (Solution method) else `^def (\w+)\(` (m flag)
  - ts/js: `function (\w+)\s*\(` else `(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\(`
  - csharp: first `public\s+(?!class)[\w<>\[\],?\s]+?\s+(\w+)\s*\(` inside the file
- **Harness contract** (all languages): the harness runs every case, catching
  per-case exceptions, and prints ONE final stdout line:
  `{"results": [{"got": <json>, "error": <string|null>}, ...]}` or
  `{"fatal": "<message>"}` if the code itself failed to load/compile.
  `got` must be JSON-serialized by the harness (null when errored).
- **python**: stdin script (verifyCard pattern): `exec` the student code in a
  ns; entry = `getattr(ns['Solution'](), name)` when Solution exists else
  `ns[name]`; call with `*args` from embedded JSON; 15s timeout.
- **typescript / javascript**: write `<tmp>/runner.ts` = student code +
  trailer that reads embedded cases JSON, calls `name(...args)`, collects
  results, `console.log(JSON.stringify(...))`. Run `npx tsx runner.ts` from
  the `server/` cwd (where tsx is installed), 20s timeout, killTree on kill
  (npx spawns a chain). Use a temp dir under os.tmpdir().
- **csharp**: persistent scratch project `server/.run-scratch/csharp/`
  (gitignored) with `run.csproj` (net9.0, OutputType Exe, ImplicitUsings
  enable, Nullable disable) — created on demand like the LSP workspace but a
  SEPARATE directory (never share the LSP scratch). Write `Program.cs` =
  student code + a static harness class with a `Main` that: finds
  `Solution`'s method by name via reflection, deserializes each case's args
  JSON to the method's `ParameterInfo` types with `System.Text.Json`, invokes,
  serializes the return value with JsonSerializer, accumulates the results
  object, prints the single JSON line. Cases JSON passed via an env var or a
  cases.json file next to Program.cs (file is simpler). Run
  `dotnet run --project <dir>` with a **60s** timeout (first build restores +
  compiles; later runs ~2-4s). Compile errors land on stderr → fatal error
  with the first ~10 lines of stderr.
- **Comparison** (shared TS, applied to harness output): parse `got` JSON,
  deep-equal vs `expected`; leniency: when both are arrays and their sorted
  JSON serializations match, pass (mirrors verifyCard's any-order rule).
  `RunCaseResult.expected`/`got` are JSON.stringify'd for display.
- All child processes: kill on timeout (taskkill /T /F on win32 — reuse/share
  the `killTree` shape from llm.ts; export it from llm.ts rather than
  duplicating if clean).

## Server

### 3. `server/src/server.ts` + `server/src/engine.ts`
- The `sessions` Map currently stores `TutorSession` only. Change it to
  `{ session: TutorSession; card: ProblemCard; cardName: string }` (both
  creation sites: /api/session uses the card name; /api/start uses the slug).
  The submit route uses `entry.session` — SSE flow otherwise untouched.
- NEW route `POST /api/session/:id/run` body `{ code: string; language: string }`:
  - 404 unknown session; 400 missing code / unsupported language.
  - Lazily `extractCases(card.examples)` and CACHE the result on the session
    entry (cases don't change).
  - `scaffold` = the matching snippet from `loadSnippets(cardName)`
    (langSlug map: python→python3, typescript, javascript, csharp).
  - Respond plain JSON `{ cases, error? }` (StudentRunResult). NOT SSE.
- engine.ts re-exports whatever the server needs from the two new engine files.

## Web

### 4. `web/src/api.ts`
`runExamples(sessionId, code, language): Promise<StudentRunResult>` (plain
POST/JSON, `request` helper).

### 5. `web/src/App.tsx` + `index.css`
- `const RUNNABLE = new Set(['python', 'typescript', 'javascript', 'csharp'])`.
- In the `.worklabel` row, before the langpick: a `run the examples` button
  (class `runbtn`), rendered only when `RUNNABLE.has(lang) && sessionId &&
  code.trim()`. While running: disabled, label `running…` (csharp first run
  compiles — that's fine, same label).
- State: `const [run, setRun] = useState<StudentRunResult | null>(null)` +
  `running` bool. New run replaces old. Reset `run` to null when a new
  problem loads and when the language changes.
- Results strip under `.editor-shell` (class `runresults`, only when `run`):
  - `run.error` → single coral line.
  - else one mono row per case: `✓`/`✗`, the case `display`, and for fails
    `→ got X (want Y)` — got/expected already stringified. Per-case `error`
    (their code threw) shows the error text instead of got/want.
  - Chalk voice, lowercase, `.pass` = var(--chalk-dim) with sky ✓, `.fail` =
    coral. Keep it a quiet strip, not a giant panel.
- **Tutor integration**: `reviewPrompt(code)` gains an optional second param —
  when the latest `run` exists, append:
  `\n\nMy latest test run:\n<one line per case: PASS/FAIL display (got X, expected Y)>`
  so the gate/teacher see real results. The review button passes it.

## What NOT to do
- Don't touch the SSE submit flow, the LSP bridge/scratch, prompts, or trace.
- No new dependencies anywhere.
- Don't run the student's code through an LLM — this is deterministic.
- Don't persist run results server-side.
- In-place/void problems (rare; method mutates an arg and returns nothing):
  out of scope — the comparison will just fail; acceptable, note it.

## Verify before you report back (no dev servers, no browser)
Write a throwaway node script (tsx) that calls `runStudentCode` directly and
run it for:
1. python correct two-sum (Solution class form) → 3/3 pass
2. typescript correct two-sum (function form) → 3/3 pass, including the
   any-order leniency (return `[1, 0]` for one case → still pass)
3. csharp correct two-sum → 3/3 pass (first run compiles; allow the 60s)
4. a wrong solution (any lang) → fails with got/want populated
5. a crashing solution → per-case or fatal error surfaced, no hang
6. `while(true){}` / `while True:` → killed by timeout, readable error, and
   NO leftover node/python/dotnet processes (check!)
Use `extractCases` on the real two-sum card's examples for the cases input.
Also: `npx tsc --noEmit` in engine, server; `npx tsc --noEmit -p
tsconfig.app.json` in web. Include all outputs in the report.

## Report back
Files changed, commands run + outputs (especially the 6-scenario matrix),
and residual risk. Note anything in the spec that didn't match reality.
