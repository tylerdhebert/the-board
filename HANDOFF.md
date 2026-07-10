# Handoff — socratic-tutor

Living state doc so a new chat can resume without re-deriving everything. Pair
with `DESIGN.md` (architecture + validation findings). Last updated 2026-07-09.

## What this is
A Socratic coding tutor that **leads you to the answer and never hands it over**.
You give it a problem (name or LeetCode link), it fetches + ingests it, and you
work in a code editor while a tutor nudges you with questions. Full-stack app,
working end to end. Repo: `C:\Users\Tyler\Documents\projects\socratic-tutor`.

## Architecture (three packages, `web ← server ← engine`)
- `engine/` — headless TS tutor engine. The loop per turn (`TutorSession.submit`):
  deterministic **leak-term unlock** (prefilter → unlock judge → mutate locked set)
  → **teacher** drafts a reply + declares a MODE → **gate** vets it (mode-aware)
  → redraft-once on REVISE. Also: `ingest` (statement → card, **verified by
  executing the reference code**), `fetchProblem` (LeetCode GraphQL, now incl.
  `codeSnippets`), per-turn JSONL **trace** (`logs/`), per-role **backend**
  selection (`SessionModels` = `{backend,model}` per role; backends: `codex`,
  `claude`; registry in `providers.ts`). `LLMClient` interface; `CodexCliClient`
  shells `codex exec`. Everything runs under `tsx` (no build step needed).
- `server/` — zero-dep `node:http` API. Holds the **answer key server-side**;
  sends the client ONLY student-safe fields. Endpoints: `GET /api/cards`,
  `POST /api/session {cardName}`, `POST /api/start {query}` (name/link → slug →
  fetch+ingest+cache → session), `POST /api/session/:id/submit {message}`.
- `web/` — Vite + React + TS. **"The Board"** chalkboard UI (see Design below).
  Monaco editor seeded with LeetCode scaffolds; tutor as margin annotations.

## The MODE dial + de-escalation (the product's soul — don't water down)
Teacher declares `MODE: socratic|analog|scaffold` on line 1 of every reply; the
gate's strictness is a function of the mode. `socratic` = never reveal (protected
by per-problem `leak_terms`). When a student is genuinely stuck across ~3 hints,
teacher de-escalates: `analog` (teach the missing primitive via a simpler
problem — **paced**, must engage before bridging back) or `scaffold` (faded
pseudocode). Leak terms **unlock** once the student *commits* to an idea (a
separate unlock judge distinguishes commit from fishing). All validated live —
see DESIGN.md §5, §8, and the de-escalation pressure test.

## Design language ("The Board")
Teacher's slate. Deep green-slate `#16241d`, warm chalk `#ece6d6`, amber (tutor)
`#f0c34a`, coral (you) `#ef8a6a`. Fonts: Bricolage Grotesque (display) / Space
Grotesk (body) / Space Mono (code). **Signature: hand-drawn chalk outlines** via
an SVG turbulence filter (`#chalk-rough`) on `.chalk::before` borders — NO
rounded rectangles. Tutor speaks as margin annotations, not chat bubbles. Keep it
distinctive; the user explicitly rejected the generic dark-rounded-card look.

## How to run
```
npm run desktop        # THE app: api + web + frameless Electron shell (one command,
                       # closing the window tears everything down)
npm run dev            # browser mode: api :8787 + web :5173, open the URL in a tab
# or separately:
cd server && PORT=8787 npx tsx src/server.ts
cd web && npx vite
```
For UI debugging in the shell (CDP, screenshots, eval) see
`docs/desktop-debugging.md`.
Requires `codex` (and optionally `claude`) CLI on PATH. First novel problem
takes ~30–60s to ingest, then it's cached in `cards/`.

**NOTE (2026-07-09, streaming session):** the stack is running via `npm run dev`
(api **8787**, web **5173**). If you change `server/` or `engine/` code you must
restart 8787 to pick it up (tsx isn't in watch mode). Web changes hot-reload.

## Conventions & gotchas (learned the hard way)
- **Implementer = Grok 4.5 via Cursor** (`grok-4.5-xhigh`), driven through the
  `cli-subagents` skill's `cursor-subagent.ps1`. Claude specs + reviews every
  diff. See `.agent-tasks/*.md` for the increment specs.
- **Cursor arg-parsing bug:** the runner appends the prompt as a positional arg,
  so any `--flag` in the prompt leaks into `cursor-agent`'s argv and crashes it.
  ALWAYS put the real spec in a file (`.agent-tasks/foo.md`) and give cursor a
  short flag-free prompt: "read .agent-tasks/foo.md and implement it exactly."
- **Orphaned codex processes:** backgrounding multiple `codex exec` (e.g. via `&`
  under a `wait` that times out) leaves orphans that contend and make everything
  crawl. Kill with PowerShell `Get-Process | ? ProcessName -match codex | Stop-Process`.
  The ENGINE's own CLI calls self-protect since `dc06fb3`: a codex stream once
  stalled silently and hung /api/start forever, so `runCli` (llm.ts) has a 120s
  inactivity watchdog (`TUTOR_CLI_INACTIVITY_MS` to override) that tree-kills
  (`taskkill /T`) and errors; `verifyCard` caps reference-code runs at 30s.
- **UTF-8:** codex demands UTF-8 stdin; set `PYTHONUTF8=1`, write files UTF-8.
  Don't use unquoted bash heredocs for JS/Playwright — `$(...)`/`$` get expanded.
- **Answer key must NEVER reach the client** — server whitelists fields explicitly.
- LF→CRLF git warnings are harmless (Windows).
- Screenshots: Playwright + system Chrome (`chromium.launch({channel:'chrome'})`)
  works; save to `$TEMP/tutor-shots` and Read the PNG.

## Roadmap (user's stated priorities, in order)
1. ~~**Streaming**~~ SHIPPED 2026-07-09 (`fd17dac`, spec `.agent-tasks/streaming.md`).
   Stage events (`unlock|draft|gate|redraft`) stream over **SSE on the POST**
   (client reads with a fetch stream reader, deliberately NOT EventSource —
   auto-reconnect would resubmit the turn), then a typewriter reveal (~180
   chars/s, click-to-finish, unlocked line lands after the reveal). The raw
   teacher draft still never leaves the server before the gate approves it.
   Implemented by Grok 4.5 via cursor-subagent; verified live end to end
   (unlock → draft → gate → REVISE → redraft → re-gate in one real turn).
2. ~~**C# language server**~~ SHIPPED 2026-07-09 (`9cde509`, spec
   `.agent-tasks/csharp-lsp.md`). Deliberately NOT monaco-languageclient — a
   slim hand-rolled client (user's explicit choice): `web/src/lsp/jsonrpc.ts` +
   `csharpLsp.ts` (four Monaco providers), `server/src/lsp.ts` ws bridge
   spawning `csharp-ls` against `server/.lsp-scratch/`. PREREQ + gotcha:
   `dotnet tool install --global csharp-ls --version 0.20.0` — 0.21+ are
   net10.0-only and fail on the local .NET 9 SDK with a misleading
   "DotnetToolSettings.xml not found" error; bump only after moving to SDK 10.
   Client subtleties that matter: didOpen empty → wait `$/progress` end →
   didChange overlay; requests flush pending didChange first (stale-buffer
   race, observed live). AI autocomplete stays banned.
3. ~~**Electron shell**~~ SHIPPED 2026-07-09 (`7a15720`, spec
   `.agent-tasks/electron-shell.md`). `npm run desktop` = api + vite + a
   frameless Electron window via the tree-kill launcher; the header strip is
   the titlebar (drag region + chalk winctl controls, browser mode untouched).
   AI-debug tooling mirrors effortless: CDP :9223, `window.tutorDesktop`
   bridge, `node scripts/shot.mjs capture|eval` (native screenshots to
   gitignored `.shots/`, path + sha256) — canonical workflow in
   `docs/desktop-debugging.md`. Gotcha baked in: occlusion calc + background
   throttling are disabled or capturePage throws UnknownVizError when the
   window is covered. Still open: packaging/installer (electron-builder) if
   ever wanted.
4. ~~**Run my code**~~ SHIPPED 2026-07-09 (`b1438cf`, spec
   `.agent-tasks/run-my-code.md`, chosen over persistence/ledger as the biggest
   product hole). Run-the-examples button executes the student's buffer against
   the card examples (python / ts / js / csharp; entry point detected from
   their code, scaffold fallback) with pass/fail + got-vs-want under the
   editor; review-my-work appends the latest run so the tutor targets the real
   failing case. Cases come from a python-ast extraction of the card's
   python-expression examples; csharp runs via a reflection harness in
   `server/.run-scratch/csharp/` (first run compiles). In-place/void problems
   fail comparison — accepted. Also hardened dev.mjs shutdown (waits for
   taskkill trees; the 500ms exit orphaned the whole stack once).
5. **API-client backends** (`AnthropicClient`/`OpenAIClient` implementing
   `LLMClient`) for when the user has API keys — faster + structured JSON output
   removes `completeJson`'s parse-guessing. No keys in env as of this session;
   user churns CLI subscriptions (codex/cursor/opencode), so CLI adapters matter.
6. ~~**Persistence + the ledger**~~ SHIPPED 2026-07-09 (`fc99e79`, spec
   `.agent-tasks/persistence-ledger.md`). Write-through JSON-per-session in
   gitignored `sessions/` + transparent rehydration (unknown session id →
   restore from disk; `TutorSession` has a `restore` constructor opt). Hero
   pane = the ledger: status marks (✓/~/·), per-problem session history,
   resume (transcript + editor buffer + lang + last run), fresh start,
   wordmark = way home. Solved marked server-side on an all-pass run.
   `/api/cards` deleted → `/api/problems`.
7. ~~**SQLite migration**~~ SHIPPED 2026-07-09 (`acd0582`, spec
   `.agent-tasks/sqlite-store.md`). Persistence backs onto `tutor.db`
   (gitignored, repo root) via **node:sqlite** — built into node ≥22, zero
   deps, no native prebuilds, cross-platform by construction. sessionStore.ts
   API unchanged (that seam was the whole point); cards/snippets stay as
   git-committed files. Boot migration imports legacy `sessions/*.json` →
   renames dir to `sessions.migrated/`. LESSON for future specs: the
   implementing subagent used the REAL store paths as test fixtures and its
   own cleanup sweep killed it mid-run (and the running desktop api) — test
   fixtures must use isolated paths, and broad process kills are banned.
8. ~~**Polish pack**~~ SHIPPED 2026-07-09 (`7d2c0d2`): ledger hides/prunes
   empty sessions + first-message snippets; honest void-return run errors;
   JsonlTracer wired (every session → `logs/<id>.jsonl`); window state
   remembered; C# LSP dormant-not-dead across language switches (0.8s
   switch-back). `TUTOR_DB_PATH` env for isolated fixtures.
9. ~~**Provider settings**~~ SHIPPED 2026-07-09 (`cabae01`): strip `providers`
   button → chalk modal, per-role backend/model (teacher/gate/unlock/ingest),
   persisted in tutor.db `settings`, applied at construction/rehydration +
   ingest. Includes the fence fix: claude wraps JSON in ```-fences;
   completeJson unwraps (verified with a real claude/sonnet-gated turn that
   REVISEd).
10. ~~**Takes**~~ SHIPPED 2026-07-09 (`b254195`, spec `.agent-tasks/takes.md`):
   every run snapshots {code, lang, results} (takes table); chips with pass
   counts under the editor; chip click = FULL CHECKOUT with auto-snapshot of
   dirty work as a –/n take (user's design); dirty `*` on the run button.
   Plus: editor now flexes to fill the window (was fixed 320px + dead band).
11. **THE PLAN (agreed 2026-07-10 morning, user's priorities — next sessions
   work top-down):**
   - **NOTE: the working tree has UNCOMMITTED user experiments** in
     web/src/App.tsx + index.css (textarea rows=6, full-width Send on its own
     row, margin 400px → 25vw). They are the user's live prototype of Round
     A's ergonomics — treat them as design intent, implement properly
     (auto-grow + cap + top drag handle; resizable margin), then supersede
     them. Do NOT blindly discard.
   - **Round A (first, tonight-sized):**
     (a) ~~BUG: sticky "running…"~~ FIXED 2026-07-10 (uncommitted? see
     CURRENT STATE below; spec + full diagnosis in
     `.agent-tasks/sticky-running.md`). Root cause was NOT a response-shape
     mismatch: every child runner settled only on the child's `'close'`
     event, which waits for stdio pipes — a kill-race survivor (orphaned
     esbuild/codex grandchild holding inherited handles) keeps them open
     forever, so a timed-out run could hang the endpoint and wedge the
     button. Fix: guarded settle + 5s post-kill grace in runStudentCode /
     llm runCli / extractCases / verifyCard, plus a client-side 120s
     AbortSignal cap on the run fetch and real error messages surfaced
     from `{error}` bodies. Verified live on an isolated server (python
     15s + ts 20s timeouts, happy path 3/3). Implemented by grok-4.5-xhigh
     via cursor-subagent, diff sign-off + verification by Claude.
     (b) review-my-work + commentary: composer text rides along as
     "my notes:" on the review turn (user already does this manually).
     (c) chat ergonomics: resizable margin (drag divider, width in
     localStorage), textarea auto-grows a FEW lines max (~5-6 rows cap) with
     a DRAG HANDLE ON ITS TOP EDGE to pull up manually; styling pass —
     soft shadow on student notes, faint glow on tutor notes, chalk
     treatment for the textarea.
   - **Round B (tutor sees the board, pull not push):** do NOT send the
     buffer every turn. Server materializes the buffer to a per-session
     scratch file each turn; the teacher prompt gets ONE lightweight line
     (attempt N · x/y passing · language · last failing case) plus "the
     student's editor is at ./editor.<ext> — read it if you need it".
     codex exec / claude -p can read files themselves — the CLI's own
     agency IS the fetch tool. Teacher cwd = that scratch dir. Also:
     pseudocode/idioms must follow the student's current language.
   - **Python LSP:** spec `.agent-tasks/python-lsp.md` (pyright over the
     generalized /lsp/:lang bridge; picker already promises python).
   - **Round C (stress cases — REVISED 07-10 after user's oracle-trust
     concern; principle: wrong cases must be HARMLESS and CHEAP TO KILL,
     not impossible):** LLM proposes adversarial INPUTS only; expected
     outputs come from EXECUTING the reference (sandbox + timeouts);
     differential testing with CROSS-PROVIDER decorrelation (brute-force
     impl written by the OTHER configured backend, verified on base
     examples; stress inputs must agree between brute and optimal or drop);
     generated input-constraint validator (failure direction = drop).
     FINAL SHAPE (07-10, third revision — user called overengineering;
     MINIMAL version wins): LLM proposes inputs, verified reference
     executes them for expected outputs, and exactly TWO passive rules:
     (1) stress NEVER gates solved (SOLVED = official examples only);
     (2) stress rows visually distinct + counted separately. NO dispute
     buttons, NO 3-way ceremony, NO delete — the dispute mechanism is the
     CHAT that already exists (tell the tutor "I think this case is wrong";
     it has the answer key + Round B editor access). Verified 07-10: LC
     GraphQL does NOT expose hidden judge tests (only exampleTestcases =
     the visible ones, inputs only; metaData = function signature — useful
     for entry points/mutation detection later). Known upgrade path if
     wrong cases become a real problem: LC's authenticated custom-input
     Run endpoint returns LC's own expected_code_answer (true oracle, needs
     session cookie, unofficial API) — swap the oracle, keep everything
     else. Persist `stress: [{input, output}]` on the card; "chalk up
     tougher cases" button (~40s once, cached).
   - **Round D (the fun — DISCUSS with user before building):**
     (1) concept board: locked leak-terms rendered as chalk smears/erased
     words in the dead zone right of the statement; earning a term writes
     it back in (unlockedThisTurn already flows). No info leak beyond count.
     (2) tutor points at code: optional `POINT: <line>` control line in the
     teacher protocol (stripped like MODE, gate-checked) → chalk
     arrow/underline Monaco decoration + margin note anchored like a speech
     bubble. (3) interactive scaffold blanks: scaffold mode is PROMPTED
     (teacher_tmpl MODE: scaffold) — emit stable `____` blanks, render as
     inline chalk inputs, "send back" composes the filled version.
   - **Maybe:** provider-check button (live one-line completion probe per
     role, ✓/✗ + latency — ground truth, no LLM model knowledge; the
     models-suggestion list was CUT by the user: no LLM-known slug lists).
   - **Backlog:** API-client backends (waiting on keys), mutation-problem
     run support (infer check mode at ingest), README refresh (very stale).

## CURRENT STATE (2026-07-10, Round A session — read this first)

Concise pickup list for the next agent (codex):

1. **Round A(a) sticky-running fix: DONE + verified**, committed as the
   commit touching `engine/src/{runStudentCode,llm,exampleCases,ingest}.ts`
   + `web/src/api.ts`. **The live stack has NOT picked it up** — tsx isn't
   in watch mode, so restart the api (or the whole `npm run desktop`) when
   convenient. Web half hot-reloads by itself.
2. **Round A(b/c): DONE + build-verified, currently uncommitted.** Implemented
   by `grok-4.5-xhigh` through Cursor from
   `.agent-tasks/round-a-ergonomics.md`. Review-my-work now includes non-empty
   composer text under `My notes:` and clears the composer after submission.
   The tutor margin has a persisted pointer/keyboard resize divider; the
   composer auto-grows to six lines, supports manual top-edge resizing, and
   keeps Send on its own full-width row. Student/tutor notes and the composer
   received the planned restrained shadow/glow/chalk styling. Tyler's
   prototypes in `web/src/App.tsx` + `web/src/index.css` were preserved as
   design intent and superseded by the complete behavior. `bun run build` in
   `web/` passes on 2026-07-10.
3. **Python LSP: DONE + verified, currently uncommitted.** Implemented by
   `grok-4.5-xhigh` through Cursor from `.agent-tasks/python-lsp.md`. Pyright
   now runs over the generalized per-language websocket bridge; Monaco keeps
   one lazy LSP handle per language and deactivates the other on language
   switches. The orchestrator added a per-language startup guard after review
   so overlapping React effects cannot create duplicate sessions. Grok's
   isolated bridge checks returned 163 Python completions (including `path`)
   and 50 C# completions (including `WriteLine`); its scratch server exited by
   PID. Independent engine/server TypeScript checks and the web production
   build all pass on 2026-07-10.
4. **Round B: DONE + verified, currently uncommitted.** Implemented by
   `grok-4.5-xhigh` through Cursor from
   `.agent-tasks/round-b-board-access.md`. Before each turn the web client
   serializes and flushes editor saves, then the server materializes the
   current buffer as `server/.teacher-scratch/<session>/editor.<ext>` (or the
   isolated `TUTOR_TEACHER_SCRATCH_DIR`). The teacher alone receives that
   directory as its CLI cwd plus a compact `BOARD:` status line and relative
   editor path; gate/unlock remain unchanged. Review-my-work no longer embeds
   source or verbose run output in the transcript. The teacher template keeps
   pseudocode/scaffolds in the selected language. A fake-client redraft check
   proved exact source on disk, source absent from prompts, teacher cwd on both
   drafts, and no cwd on gate/unlock. Independent engine/server TypeScript
   checks and the web production build pass on 2026-07-10.
5. **Round C minimal: DONE + verified, currently uncommitted.** Implemented by
   `grok-4.5-xhigh` through Cursor from `.agent-tasks/round-c-stress.md`. The
   configured ingest model proposes call inputs only; a short-timeout Python
   oracle executes the verified reference independently for each accepted
   literal call and caches valid `{input, output}` rows on the card. Runs carry
   official and tougher rows together with explicit stress markers. Official
   examples alone determine solved; tougher rows are grouped, styled, and
   scored separately. The client sees only `stressCount`, never cached rows or
   answer-key fields. An isolated fake-LLM check covered invalid/duplicate/
   throwing proposals, oracle-derived output, stress marker propagation, both
   solved-gating directions, and safe payload keys. Independent engine/server
   TypeScript checks and the web production build pass on 2026-07-10. Live
   generation with the configured ingest CLI remains to be manually exercised
   after the API restart.
6. **Student-safe ingest contract: DONE + verified, currently uncommitted.**
   `prompts/ingest_prompt.md` and `schema.json` now identify `statement` and
   `constraints` as student-visible verbatim fields and reserve inferred
   strategies, algorithm steps, data structures, complexity guidance, and
   solution hints for private card fields. All seven tracked built-in cards
   had derived guidance removed from `constraints`; explicit input/domain
   limits and problem requirements remain. Every card and the schema parse as
   JSON, and `git diff --check` passes on 2026-07-10.
7. **Claude review of the batch (2026-07-10 afternoon): PASSED + polish
   applied, uncommitted.** Full diff review + independent verification
   (3× tsc, web build, live isolated server on :8791: payload leak check,
   solved gating official-only, per-lang /api/lsp/info, pyright ws
   handshake). Three review findings fixed from
   `.agent-tasks/review-polish.md` (grok-4.5-xhigh via cursor): review
   notes now visible in the transcript as a 2-line-clamped `.say-sub`
   under "↳ review my work" (display-text encoding, no persistence
   change); stress rows propagate to sibling in-memory sessions on the
   same card + disk-reload guard on the stress endpoint; unrun attempt
   chips show `–/N` again. Known-minor leftovers: concurrent stress
   clicks from two sessions of the same card can double-generate
   (per-session inflight keys); teacher-scratch dirs accumulate per
   session (needs a userData/cleanup story if the app is ever packaged).
8. **Next:** Round D, which must be discussed with the user before building.
9. **Conventions:** implementation goes to CLI subagents (implementer =
   grok-4.5-xhigh via the cli-subagents skill's cursor-subagent.ps1; spec
   in `.agent-tasks/*.md`, short flag-free prompt "read X and implement it
   exactly"); orchestrator writes the spec, reviews the diff, verifies
   live. Verification pattern that works: isolated server on :8790 with
   `TUTOR_DB_PATH` pointing at a scratch db — never test against the real
   tutor.db (three test sessions leaked into it this session and were
   deleted; the running 8787 may still list them in the ledger until
   restarted).

## Recently shipped
- **2026-07-09 (streaming session):** SSE stage streaming + typewriter reveal
  (`fd17dac`, see roadmap item 1). Committed and verified live.
- **Earlier sessions:** Engine Increments 1–7, server, web UI, "The Board"
  redesign, Monaco + review, on-the-fly name/link ingest, chalk loading state,
  root `npm run dev` launcher, LeetCode code-scaffold seeding. All committed.
