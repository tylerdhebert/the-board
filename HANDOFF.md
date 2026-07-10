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
11. **API-client backends** — see item 5 above (unchanged, waiting on keys).
   Also queued ideas: mutation-problem support for run-my-code (infer check
   mode at ingest by observing the reference solution — return vs mutated
   arg), UI touch-up round (user wants to discuss), README refresh (stale
   since streaming).

## Recently shipped
- **2026-07-09 (streaming session):** SSE stage streaming + typewriter reveal
  (`fd17dac`, see roadmap item 1). Committed and verified live.
- **Earlier sessions:** Engine Increments 1–7, server, web UI, "The Board"
  redesign, Monaco + review, on-the-fly name/link ingest, chalk loading state,
  root `npm run dev` launcher, LeetCode code-scaffold seeding. All committed.
