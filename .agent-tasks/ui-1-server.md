# TASK: UI-1 — thin Node API server over the engine

A minimal zero-dependency HTTP server that exposes the tutor engine to a browser
UI. It holds sessions server-side and NEVER sends the answer key to the client.

## Hard rules
- Create a new top-level `server/` directory (sibling of `engine/`). Work only there
  (plus you may READ `engine/` and `cards/`).
- Do NOT run any git write command. NO npm dependencies — use Node built-ins only
  (`node:http`, `node:fs`, `node:crypto`, `node:url`, `node:path`).
- TypeScript, run via `tsx`. `strict` on; a `typecheck` script must pass.
- CRITICAL — NEVER send answer-key fields to the client. The session/problem
  responses must include ONLY student-safe fields: `title`, `statement`,
  `constraints`, `difficulty?`. NEVER include `optimal`, `key_insight`,
  `leak_terms`, `traps`, `brute_force`, `ladder`, or `underlying_primitive`.

## Files (all under `server/`)
### `server/package.json`
- name "tutor-server", private, type module. scripts: `"dev": "tsx watch src/server.ts"`,
  `"start": "tsx src/server.ts"`, `"typecheck": "tsc --noEmit"`.
- devDependencies ONLY: `typescript` ^5.7, `tsx` ^4.19, `@types/node` ^22. No runtime deps.

### `server/tsconfig.json`
- Same style as engine: strict, ES2022, NodeNext module+resolution, esModuleInterop,
  resolveJsonModule, skipLibCheck, noUncheckedIndexedAccess, `include: ["src"]`.

### `server/src/engine.ts`
- Re-import what you need from the engine by RELATIVE path, e.g.
  `import { TutorSession, ingest, fetchProblem, type ProblemCard, type SessionModels } from '../../engine/src/index.js'`.
  (Running under tsx resolves the engine's TS source. If this import path fails at
  runtime, say so clearly in your report — do not silently work around it.)
- Export a default `SessionModels` constant (all codex):
  `{ teacher:{backend:'codex',model:'gpt-5.5'}, gate:{backend:'codex',model:'gpt-5.4-mini'}, unlock:{backend:'codex',model:'gpt-5.4-mini'} }`.
- Export `studentSafeProblem(card: ProblemCard)` returning ONLY
  `{ title, statement, constraints }`.
- Export `loadCard(name: string): Promise<ProblemCard>` reading
  `<repoRoot>/cards/<name>.card.json` (resolve repoRoot from import.meta.url; server/src -> up two). Reject a name containing `/`, `\`, or `..` (path-traversal guard).
- Export `listCards(): Promise<{name,title}[]>` — read the `cards/` dir, for each
  `*.card.json` return `{ name: <basename without .card.json>, title }`.

### `server/src/server.ts`
A `node:http` server (PORT from env `PORT` or 8787). Small JSON helpers: read a
JSON body, send JSON with status + permissive CORS headers
(`Access-Control-Allow-Origin: *`, allow `POST, GET, OPTIONS`, allow `Content-Type`).
Handle `OPTIONS` preflight with 204. In-memory `sessions = new Map<string, TutorSession>()`.
Routes:
- `GET  /api/cards` -> `listCards()`.
- `POST /api/session` body `{ cardName: string }` -> `loadCard`, create a
  `new TutorSession(card, DEFAULT_MODELS)`, store under a `crypto.randomUUID()` id,
  respond `{ sessionId, problem: studentSafeProblem(card) }`. 404 if the card is missing.
- `POST /api/session/:id/submit` body `{ message: string }` -> look up the session
  (404 if unknown), `await session.submit(message)`, respond with ONLY
  `{ reply, mode, unlockedThisTurn, redrafted }` (NOT the gate verdict/note).
- Anything else -> 404 JSON.
- Wrap handlers so a thrown error responds 500 `{ error: message }` (never crash the process).
Log a line on startup: `tutor server on http://localhost:<port>`.

## Verification (run and report exact outputs)
1. `npm install` then `npm run typecheck` in `server/` — zero errors.
2. Start the server in the background (e.g. `PORT=8788 npx tsx src/server.ts &`), wait ~1s, then with Node's fetch (write a tiny throwaway `server/_probe.ts`, delete after) OR `curl`:
   - `GET /api/cards` -> print (expect two_sum / container_water / house_robber).
   - `POST /api/session {cardName:'two_sum'}` -> print the response; ASSERT the
     `problem` object has NO `leak_terms`/`optimal`/`key_insight` keys (print the key list to prove it).
   - `POST /api/session/:id/submit {message:'not sure where to start'}` -> print
     `{ reply(first 80 chars), mode, unlockedThisTurn, redrafted }`.
   - Stop the background server.
   Report the actual outputs.

## Report back
1. Files created. 2. typecheck result + the three endpoint outputs (proving no
answer-key leakage in the session response). 3. Whether the engine relative import
worked at runtime, and any residual risk.
