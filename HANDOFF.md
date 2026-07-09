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
npm run dev            # from repo root — launches api :8787 + web :5173 together,
                       # with a tree-kill launcher (dev.mjs) that cleans up both.
# or separately:
cd server && PORT=8787 npx tsx src/server.ts
cd web && npx vite
```
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
3. **Electron shell** (confirmed 2026-07-09 — the user always intended this to
   be an Electron app; the intent predates the handoff docs and was lost, so it
   is recorded here now). Packaging-only: main process boots the api server,
   window loads the web build. The web/server split (answer-key boundary) and
   the LSP-over-WebSocket bridge carry over unchanged.
4. **API-client backends** (`AnthropicClient`/`OpenAIClient` implementing
   `LLMClient`) for when the user has API keys — faster + structured JSON output
   removes `completeJson`'s parse-guessing. No keys in env as of this session;
   user churns CLI subscriptions (codex/cursor/opencode), so CLI adapters matter.

## Recently shipped
- **2026-07-09 (streaming session):** SSE stage streaming + typewriter reveal
  (`fd17dac`, see roadmap item 1). Committed and verified live.
- **Earlier sessions:** Engine Increments 1–7, server, web UI, "The Board"
  redesign, Monaco + review, on-the-fly name/link ingest, chalk loading state,
  root `npm run dev` launcher, LeetCode code-scaffold seeding. All committed.
