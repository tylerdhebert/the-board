# Known warts

Honest engineering debts, 2026-07-11. Roughly ordered by how much each one
touches the product's soul.

1. **The gate is probabilistic, not proven.** "Never leaks the answer" is
   enforced by a second LLM judging a draft, plus deterministic `leak_terms`
   string-matching. It has not been red-teamed since the 07-09 pressure test
   and can likely be sweet-talked. *Path:* adversarial red-team suite; more
   deterministic checks (e.g. n-gram overlap between draft and
   `optimal.code`/`key_insight`).

2. **The answer key leaks into CLI session logs.** It never reaches the
   client, but every teacher prompt (optimal solution, ladder, insight) is
   fed to `codex`/`claude`, which log sessions to disk (`~/.codex`, etc.).
   Local-machine-only exposure, but worth knowing. *Path:* ephemeral/no-log
   flags where the CLIs support them.

3. **Turn latency: up to 4 cold CLI spawns per message** (unlock judge →
   teacher → gate → redraft → re-gate), each a fresh `codex exec` with full
   context re-fed. 15–40s per nudge. See "turn latency" below for the
   no-API-pricing mitigation paths.

4. **Mutation/in-place problems don't grade.** Rotate Array et al. end in
   "got nothing back — did you return the result?" *Path:* LeetCode
   `metaData` (function signature) is already fetched — detect void-return +
   mutated-arg problems at ingest and compare the mutated argument.

5. **The stress "oracle" is a 3-test graduate.** The reference is verified
   against the official examples only, then grades adversarial inputs. The
   cross-provider differential design exists (HANDOFF Round C history) if
   wrong stress cases ever become a real problem; LC's authenticated Run
   endpoint is the true-oracle upgrade.

6. **`completeJson` is parse-and-pray.** Agent CLIs return prose; we unfence
   and `JSON.parse`. Load-bearing in ingest. *Path:* API clients with
   structured output — blocked on willingness to pay per-token.

7. **`web/src/App.tsx` is a ~1,700-line God component** (~25 useStates: fan
   math, drag physics, blank renderer, vocab, takes…). Works; scales badly.
   *Path:* extract feature components next time one grows.

8. **Resume drops the theater.** Gestures are ephemeral by design, so
   restored transcripts reference cards that aren't shown, filled scaffold
   blanks come back empty, POINT chips vanish. *Path:* persist minimal
   gesture/blank state per note if it grates.

9. **Solved/pass logic is duplicated** client (`takeAllPass`) and server
   (`officialAllPass`); it drifted once already. *Path:* server-computed
   per-take verdicts.

10. **Small stuff:** session titles are your first message verbatim ("hmmm,
    can you scaffold me"); the vocab info tooltip is hover-only (no touch);
    ~2MB of never-instantiated Monaco workers ship in dist; the no-rounded-
    rects rule has a 2px exception on the chalk piece; 345MB unpacked is the
    Electron tax (~43MB is actually us).

## Turn latency without API pricing

The constraint: tutoring must run on CLI subscriptions (codex/claude), not
per-token APIs. Paths that respect that, in order of payoff:

- **Persistent CLI workers.** Both CLIs can run as long-lived processes
  speaking JSON over stdio (`codex proto` / app-server mode; `claude -p
  --input-format stream-json --output-format stream-json`, which is what the
  Agent SDK wraps). One warm process per role, fed turns over stdin, kills
  the per-call process/auth/startup cost entirely while still billing the
  subscription. `LLMClient` is already the seam — add a `PersistentClient`
  beside `CodexCliClient`. Caveats: `codex proto` is experimental; needs the
  same inactivity watchdog + restart-on-wedge treatment `runCli` has.
- **Session reuse for context.** `codex exec resume` / `claude --resume`
  keep the conversation server-side, so each turn sends only the delta
  instead of re-feeding the whole transcript+card — shrinks prefill, which
  is most of the wall time on long sessions.
- **Local models for the small roles.** Per-role backends already exist;
  an `OllamaClient` would let gate/unlock run free-and-instant on a local
  model while the teacher stays on the subscription. The gate matters most,
  so validate quality before trusting a small model with it.
- **What doesn't work:** parallelizing the pipeline (unlock mutates the
  teacher's prompt; the gate must see the final draft — it's sequential by
  design), and skipping the gate on "safe" turns (the soul is not
  negotiable).
