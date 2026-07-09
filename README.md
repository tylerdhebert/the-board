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
| `DESIGN.md` | Architecture, the MODE dial, de-escalation, leak-terms unlock, all validation findings. |
| `engine/` | The headless TypeScript engine (below the eventual UI). |
| `prompts/` | Teacher / gate / ingest prompt templates. |
| `schema.json` | JSON Schema for a per-problem "problem card". |
| `cards/` | Generated, code-verified problem cards (two_sum, container_water, house_robber). |
| `prototype/` | The original bash validation harness (`drive.sh`) + transcripts that proved the concept. |

## Status

Concept validated end-to-end as a prompt-only prototype (see `prototype/`).
Now building the headless engine (`engine/`) toward a state where a UI can sit
on top. Build increments are specced in `.agent-tasks/`.

- ✅ Increment 1 — foundation (`types`, `LLMClient` + codex-backed dev client)
- ⏳ Increment 2 — ingest (statement → card, verified by executing the reference)
- ⏳ Increment 3 — roles (templated teacher / gate / unlock judge)
- ⏳ Increment 4 — session orchestrator + headless CLI
- ⏳ Increment 5 — live LeetCode fetch

## Engine dev

```
cd engine
npm install
npm run typecheck
```

Requires the `codex` CLI on PATH (the dev `LLMClient` shells out to it; swap in a
real API client for production).
