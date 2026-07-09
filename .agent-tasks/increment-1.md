# TASK: Increment 1 — foundation of the tutor engine

You are implementing the foundation of a headless TypeScript engine for a
Socratic coding tutor. Follow this spec EXACTLY. No extra files, no extra
features, no placeholder stubs beyond what is specified. Do not editorialize.

## Hard rules
- Work ONLY inside `engine/` (create it). Do NOT touch any file outside `engine/`.
- Do NOT run `git commit`, `git add`, or any git write command.
- Do NOT install any package other than the exact devDependencies listed below.
- TypeScript `strict` must stay on. Do NOT weaken tsconfig to silence errors.

## Context (read-only, in the PARENT dir — do not modify)
`../schema.json` is the JSON Schema for a "problem card". Your `ProblemCard`
type must mirror it exactly. `../ingest_prompt.md` and `../gate_tmpl.md` exist
for later increments; you may read them for context but do not use them now.

## Files to create (all under `engine/`)

### 1. `engine/package.json`
- `"name": "tutor-engine"`, `"private": true`, `"version": "0.0.1"`, `"type": "module"`
- scripts: `"typecheck": "tsc --noEmit"`, `"build": "tsc"`, `"dev": "tsx"`
- devDependencies ONLY (no runtime deps): `typescript` ^5.7, `tsx` ^4.19, `@types/node` ^22

### 2. `engine/tsconfig.json`
- compilerOptions: `strict: true`, `target: "ES2022"`, `module: "NodeNext"`,
  `moduleResolution: "NodeNext"`, `esModuleInterop: true`, `resolveJsonModule: true`,
  `outDir: "dist"`, `rootDir: "src"`, `skipLibCheck: true`,
  `forceConsistentCasingInFileNames: true`, `noUncheckedIndexedAccess: true`
- `include: ["src"]`

### 3. `engine/src/types.ts` — mirror `../schema.json` exactly
```ts
export interface BruteForce { approach: string; time: string; space: string }
export interface Optimal { approach: string; language: string; code: string; time: string; space: string }
export interface Trap { wrong_approach: string; why_wrong: string; counterexample: string }
export interface Example { input: string; output: string }
export interface ProblemCard {
  title: string;
  statement: string;
  constraints: string;
  brute_force: BruteForce;
  optimal: Optimal;
  key_insight: string;
  ladder: string[];
  traps: Trap[];
  leak_terms: string[];
  underlying_primitive: string;
  examples: Example[];
}
export type TutorMode = 'socratic' | 'analog' | 'scaffold';
export type GateOffense = 'leak' | 'wrong-endorsement' | 'premature-bridge' | 'premature-answer' | 'none';
export interface GateVerdict { verdict: 'PASS' | 'REVISE'; offense: GateOffense; note: string }
export interface Message { role: 'student' | 'teacher'; content: string }
```

### 4. `engine/src/llm.ts`
Define the model-client abstraction and a codex-backed dev implementation.

```ts
export interface LLMRequest { model: string; prompt: string; outputSchemaPath?: string }
export interface LLMClient { complete(req: LLMRequest): Promise<string> }
```

`export class CodexCliClient implements LLMClient` — runs codex headless and
returns the FINAL answer text. Implementation:
- Use `node:child_process` `spawn`. The command and args are EXACTLY:
  - program: `codex`
  - args: `--ask-for-approval`, `never`, `exec`, `-m`, `<req.model>`,
    `--skip-git-repo-check`, `-s`, `read-only`,
    then if `req.outputSchemaPath` is set: `--output-schema`, `<req.outputSchemaPath>`,
    then: `-o`, `<tempfile>`, `-`
- Write `req.prompt` to the child's stdin as utf-8, then end stdin.
- codex writes the final answer to `<tempfile>` (the `-o` target). Create the
  tempfile path via `os.tmpdir()` + a random name. After the process exits with
  code 0, read the tempfile as utf-8, return it `.trim()`, then delete the tempfile.
- On non-zero exit, reject with an `Error` whose message includes the collected stderr.
- Child env: spread `process.env` and add `PYTHONUTF8: '1'`.

`export async function completeJson<T>(client: LLMClient, req: LLMRequest): Promise<T>`
- calls `client.complete(req)`, then `JSON.parse`. On parse failure, throw an
  `Error` including the first 400 chars of the raw output.

### 5. `engine/src/index.ts`
Re-export everything from `./types.js` and `./llm.js` (NodeNext requires the
`.js` extension in relative import specifiers).

## Verification (you MUST run this and report the result)
From inside `engine/`: run `npm install`, then `npm run typecheck`. Typecheck
MUST pass with zero errors. If it fails, fix YOUR code (do not weaken tsconfig).

## Report back (concise)
1. Each file created, one line each.
2. Exact commands run and their outcomes (the typecheck output).
3. Any residual risk or any point where you deviated from this spec.
