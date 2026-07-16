# LC oracle: in-app LeetCode login + ground-truth expected outputs at ingest

Two card corruptions shipped on 2026-07-16 because (a) the ingest model can
hallucinate example outputs (min-cost-climbing-stairs: invented `[0,0,1,1]`
case with expected `0`, correct is `1`) and (b) `getOrIngestCard` computes
`verification` from `verifyCard` and then caches the card WITHOUT reading
`verification.ok` — the "bad card = don't let the student start" gate from
DESIGN.md §8 was never wired. Fix the gate, and add LeetCode's own judge as a
true oracle for example outputs, authenticated via an in-app login window.

The oracle is LC's unofficial custom-input run endpoint: POST
`https://leetcode.com/problems/<slug>/interpret_solution/` with
`{ question_id, lang, typed_code, data_input }` returns `{ interpret_id }`;
poll `https://leetcode.com/submissions/detail/<interpret_id>/check/` until
`state == "SUCCESS"`. The response's `expected_code_answer` is produced by
LC's canonical solution on the given input, independent of `typed_code`.
Auth = `LEETCODE_SESSION` + `csrftoken` cookies plus `x-csrftoken` and a
problem-page `Referer` header.

## Subagent ground rules

- Never use real `tutor.db`, logs, cards, or live ports as fixtures. Use temp
  files/dirs (`TUTOR_DB_PATH`, `TUTOR_DATA_DIR`) and isolated processes.
- Never kill processes by name. Kill only PIDs you start.
- Do not commit.
- Do not hit the real LeetCode API in automated checks — mock `fetch`. One
  manual live check at the end is listed under Verification.
- The LC cookie is a credential: it must never reach the web client, appear
  in logs/traces, or be echoed back by any GET endpoint.

## Part 1 — enforce the verification gate (independent of the oracle)

- `getOrIngestCard` (server/src/engine.ts): when `verification.ok` is false,
  do NOT write the card or snippets cache; throw
  `new Error('ingest verification failed: <verification.error or a summary of failing cases>')`.
  The existing `/api/start` 502 path surfaces the message.
- Keep returning `verified` for callers; delete nothing else.
- The two poisoned local cards are the user's data, not repo data — do not
  touch `%APPDATA%`. Repo cards are unaffected.

## Part 2 — LC session: login window (desktop) + paste fallback

Server:
- Store `lcSession` and `lcCsrf` in the existing sqlite `settings` store
  under a new `leetcode` key. Extend `GET /api/settings` with ONLY
  `leetcode: { signedIn: boolean }` — never the cookie values.
- `PUT /api/settings/leetcode` accepts `{ session, csrf }` (or
  `{ clear: true }`); validates non-empty strings; 204.

Desktop (main.mjs + preload):
- IPC `lc:login`: open a `BrowserWindow` (partition `persist:leetcode`,
  standard chrome, ~1000x760) at `https://leetcode.com/accounts/login/`.
  When the window is closed by the user, read cookies for domain
  `.leetcode.com` from that partition; if `LEETCODE_SESSION` and `csrftoken`
  are present, PUT them to the server settings endpoint (main already knows
  the API port) and resolve `{ signedIn: true }`, else `{ signedIn: false }`.
- Also harvest eagerly: on the login window's `did-navigate`, check cookies;
  once both cookies exist, auto-close the window and proceed. The user
  should not have to know to close it.
- IPC `lc:logout`: clear the two cookies server-side AND
  `session.fromPartition('persist:leetcode').clearStorageData()`.
- Expose `tutorDesktop.lcLogin()` / `tutorDesktop.lcLogout()` via preload.

Web (SettingsPanel):
- New "leetcode" section under the provider roles: shows `signed in` /
  `not signed in` from settings. Desktop: `sign in` button → `lcLogin()`,
  `sign out` → `lcLogout()`. Browser mode (no `window.tutorDesktop`): two
  paste fields (session cookie, csrf token) that PUT to the same endpoint.
  Chalk styling, no rounded cards, no explanatory prose beyond one line.

## Part 3 — oracle client (engine)

New module `engine/src/lcOracle.ts`:
- `fetchProblem` (leetcode.ts): also select `questionId` in the GraphQL query
  and carry it on `LeetCodeProblem`.
- `oracleExpectedOutputs(auth, slug, questionId, pythonSnippet, inputs: string[][]) => Promise<string[]>`
  where each `inputs` row is the JSON-serialized argument lines for one case
  (LC `data_input` = one argument per line; batch all cases in ONE
  interpret call separated per LC convention if straightforward, otherwise
  one call per case with ≥3s spacing — pick one, verify live, document).
- `typed_code` = the problem's python3 starter snippet verbatim (we only
  read `expected_code_answer`; the snippet merely has to compile).
- Poll `check/` with 1s interval, 60s cap, guarded like other child/network
  waits. 401/403 or a login redirect → throw
  `'LeetCode session expired — sign in again in settings'`.
- Convert `expected_code_answer` strings (JSON-ish: `true`, `null`, `[1,2]`)
  to Python literal strings (`True`, `None`, `[1, 2]`) so they slot into
  `card.examples[].output` unchanged for `extractCases`/`verifyCard`.

## Part 4 — oracle at ingest

In `getOrIngestCard`, after `ingest()` and before caching:
- Only when LC auth is configured AND `card.judge` is absent (return-value
  grading) AND the card examples parse as literal calls (reuse the existing
  AST-parse used by stress/extractCases):
  - Ask the oracle for expected outputs of every example input.
  - Overwrite each example's `output` with the oracle value. Log (server
    console) any value that differed from the model's original.
  - Re-run `verifyCard` on the corrected card; Part 1's gate then applies to
    the re-verified result.
- Oracle failure (network, expired session, rate limit) must NOT fail
  ingest: warn and fall back to the un-oracled card + Part 1 gate.
- No oracle for judge-style (in-place / k-prefix) cards — skip silently.

## Scope constraints

- No "submit to LeetCode" button, no solved-by-LC verdict (follow-up).
- No oracle for stress generation in this increment (follow-up; the seam is
  the same converter).
- No new npm dependency (use global `fetch`), no schema.json change.
- No changes to tutor modes, gate/unlock, direct mode, editor/LSP.

## Verification

- Engine/server `tsc`, `bun run build` in `web/`.
- Unit (mocked fetch): interpret→poll→expected_code_answer flow; JSON→Python
  literal conversion (`true/false/null`, nested lists, strings); expired
  session error; per-case fallback.
- Isolated server check: verification-gate rejection (feed a fake client
  returning a card whose example outputs contradict its reference; assert
  502 + no cache file written).
- Settings roundtrip: PUT cookie → GET shows `signedIn: true` and does NOT
  contain the cookie value anywhere in the response body.
- Manual live (user-driven, not automated): sign in via the window, ingest a
  problem with a deliberately wrong invented example, confirm the oracle
  corrects it and the card caches.

## Report back

Files changed, commands + concise outputs, verification evidence, residual
risk (especially: LC response-shape assumptions that were verified live vs
assumed).
