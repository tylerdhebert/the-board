# socratic-tutor

A coding-problem tutor that leads you to the answer and **never hands it over** —
a Socratic teacher that nudges you one rung at a time, de-escalates to a simpler
analogy when you're truly stuck, and refuses to reveal the solution even when you
beg. The whole product is *withholding* done well.

The core is a two-model loop: a strong **teacher** grounded by a private answer
key does the teaching; a cheap **gate** checks every reply before it reaches you
and blocks leaks. A per-problem **card** (generated + code-verified at ingest)
makes it work for any problem. See [`DESIGN.md`](./DESIGN.md) for the full
architecture and the validation findings.

## Layout

| Path | What |
|------|------|
| `web/` | The **"The Board"** React UI (Vite) — chalkboard identity, Monaco editor, tutor-in-the-margin. |
| `server/` | Thin zero-dep Node API over the engine. Holds the answer key server-side; sends only student-safe data. |
| `engine/` | The headless TypeScript engine (the tutor loop). |
| `prompts/` | Teacher / gate / ingest prompt templates. |
| `schema.json` | JSON Schema for a per-problem "problem card". |
| `cards/` | Code-verified problem cards (seeds + on-the-fly ingest cache). |
| `prototype/` | The original bash validation harness + transcripts that proved the concept. |

## Status — working end to end (engine ← server ← web)

Give it a problem **name or LeetCode link** → the server fetches + ingests +
code-verifies a card on the fly → you chat with the tutor and write code in a
Monaco editor; "review my work" critiques your buffer without ever finishing it.
The answer key never leaves the server.

- ✅ Engine (Increments 1–7): ingest, teacher/gate/unlock roles, session
  orchestrator, LeetCode fetch, per-turn JSONL trace, per-role backend selection.
- ✅ Server: `GET /api/cards`, `POST /api/session {cardName}`,
  `POST /api/session/:id/submit`, `POST /api/start {query}` (name/link → ingest).
- ✅ Web: "The Board" — chalk aesthetic, problem-by-name/link, Monaco + review.

## Run the app

```
# terminal 1 — API (needs codex/claude CLI on PATH)
cd server && npm install && PORT=8787 npx tsx src/server.ts
# terminal 2 — web
cd web && npm install && npx vite      # open the printed localhost URL
```

Then type a problem name (`two sum`) or paste a LeetCode link and hit **to the
board**. First-time novel problems take ~30–60s to fetch + ingest; after that
they're cached in `cards/`.

## Headless CLI (no browser)
```
cd engine && npm install && npm run cli
```

## Notes
- Backends: each role (teacher/gate/unlock) can run on a different backend
  (`codex`, `claude`, …) via `SessionModels` — swap when a subscription lapses.
- Every session writes a full JSONL trace to `logs/` (prompts, verdicts,
  unlocks, latencies, backend per call) for prompt tuning.
