# TASK: server — start a session from a problem NAME or LINK (on-the-fly ingest)

Replace the "pre-made card only" flow with: the user gives a problem name
("two sum") or a LeetCode URL, and the server fetches + ingests + caches the card
on the fly, then starts a session. Keep the answer key server-side.

## Hard rules
- Work ONLY in `server/` (you may READ `engine/` and `cards/`).
- Do NOT run any git write command. No new npm deps.
- CRITICAL: do NOT touch or kill anything on port 8787 (a live server is running
  there). For your verification, use PORT=8799.
- Keep the no-answer-key guarantee: responses contain ONLY student-safe fields.
- Keep the existing `GET /api/cards` and `POST /api/session {cardName}` endpoints
  working (backward compatible).

## Add to `server/src/engine.ts`
- `export function toSlug(query: string): string`
  - If `query` contains `leetcode.com` or `/problems/` or starts with `http`,
    return `slugFromUrl(query)` (import it from the engine).
  - Otherwise slugify the name: trim, lowercase, replace any run of non-alphanumeric
    chars with a single `-`, strip leading/trailing `-`. e.g. `"Two Sum"` -> `two-sum`,
    `"Container With Most Water"` -> `container-with-most-water`.
- `export async function getOrIngestCard(query: string, model = 'gpt-5.5'): Promise<{ card: ProblemCard; verified: boolean; cached: boolean }>`
  - `slug = toSlug(query)`. Guard the slug (no `/`, `\`, `..`).
  - Cache path: `<repoRoot>/cards/<slug>.card.json`. If it exists, load + return
    `{ card, verified: true, cached: true }` (assume a cached card was already good).
  - Else: `fetchProblem(slug)` -> `ingest(client, problem.statement, model)` (use a
    `CodexCliClient`). Write the card to the cache path (pretty JSON). Return
    `{ card, verified: verification.ok, cached: false }`. If `fetchProblem` throws
    (not found / premium), rethrow with a clear message.

## Add to `server/src/server.ts`
- `POST /api/start` body `{ query: string }`:
  - `getOrIngestCard(query)` -> create `new TutorSession(card, DEFAULT_MODELS)`,
    store under a uuid, respond `{ sessionId, problem: studentSafeProblem(card), cached }`.
  - On error (problem not found, fetch/ingest failure) respond 502 `{ error: message }`.
  - NOTE this call can take ~30-60s on a cache miss (fetch + ingest + verify). That's expected.

## Verification (report exact outputs) — use PORT=8799, never 8787
1. `npm run typecheck` in `server/` — zero errors.
2. Start a server on `PORT=8799` (background), then:
   - `toSlug` unit checks (print): `toSlug('Two Sum')`, `toSlug('https://leetcode.com/problems/two-sum/description/')`,
     `toSlug('Container With Most Water')` — expect `two-sum`, `two-sum`, `container-with-most-water`.
   - `POST /api/start { query: 'https://leetcode.com/problems/two-sum/' }` — this WILL
     take ~30-60s (real fetch+ingest). Print the response; ASSERT `problem` has only
     `title`/`statement`/`constraints` (no answer-key keys), and that a
     `cards/two-sum.card.json` file now exists.
   - Second `POST /api/start { query: 'two sum' }` — should be FAST (cache hit,
     `cached: true`). Print `cached` and elapsed-ish note.
   - Stop ONLY your 8799 server (leave 8787 alone).
3. Report outputs.

## Report back
1. Files changed. 2. typecheck; toSlug results; the /api/start first (uncached) +
second (cached) results proving no answer-key leak and that caching works. 3. Risk.
