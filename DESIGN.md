# Socratic LeetCode Tutor — Design Doc

A tutor that leads you to the answer of a coding problem and *never hands it
over*. Built and validated as a prompt-only prototype (no UI yet) on 2026-07-08.
This doc captures the architecture, the prompts, and everything the live runs
proved, so it survives past the exploration session.

> ⚠️ These files currently live in a **temporary scratchpad** and can be wiped.
> Move the bundle to a real repo before relying on it (see File Manifest).

---

## 1. The problem & the core bet

Anyone can paste a LeetCode problem into a chatbot and get the answer — which
teaches nothing. The entire value of this product is **withholding**: leading
the learner to the insight so they *own* it in an interview.

That makes it a **constraint problem, not a generation problem.** The hard part
is never "can the model solve it" — frontier models know these problems cold.
The hard part is making the model *refuse to reveal* while still teaching well,
and doing so reliably even when the student begs or is genuinely stuck.

**Core bet (validated):** a strong **teacher** model, *grounded by a private
answer key*, does the teaching; a cheap **gate** model checks every reply
before it reaches the student. The teacher carries the pedagogy; the gate is a
narrow safety net.

---

## 2. Architecture

```
Ingest:  a strong model privately solves the problem  ->  ANSWER KEY (hidden)
         (brute force, optimal, key insight, common traps, complexities)

Per turn:
   student message
     -> TEACHER (big model, has answer key) drafts a reply + declares a MODE
     -> GATE (small model, has answer key + the MODE) judges the draft
          PASS   -> send to student
          REVISE -> hand the note back to teacher, redraft (cap ~1-2x, then
                    send best draft anyway to avoid oscillation)
```

Key decisions:

- **Answer key up front, not per-turn correctness judging.** "Is the teacher
  about to endorse a WRONG approach" is a correctness question a small model
  can't reliably answer. Solve it once, privately, cache the key; the teacher
  is then grounded and the whole class of "confidently walks student toward a
  wrong answer" mostly disappears.
- **Problem source:** give it a LeetCode link, fetch the *statement* via
  LeetCode's GraphQL endpoint (constraints matter for good hints — `n <= 10^5`
  is what tells the tutor "your O(n^2) won't pass"). Get the *answer* by having
  the big model solve it, NOT by scraping community posts (noisy, often wrong).
- **Big model faces the student, small model gates.** Don't invert this. The
  hardest job in the loop is understanding a stranger's half-formed idea — put
  your strongest reasoning there. The gate's job (leak detection) is easy.

---

## 3. The MODE dial (the important idea)

The "leak budget" is not a fixed rule — it's a **dial with named settings**,
and the teacher turns it by declaring a MODE on the first line of every reply.
**The gate's policy is a function of that MODE.** This is what lets the tutor
deliberately reveal more when a student is truly stuck, without the gate
fighting it.

| MODE | Teacher behavior | Gate policy |
|------|------------------|-------------|
| `socratic` (default) | Smallest nudge, one rung at a time. Reveal the NEXT rung, never the destination. Never name the data structure or write solution code. | STRICT: REVISE any leak of the optimal approach/structure/code, or any wrong-endorsement. |
| `analog` | Student is missing a *concept/primitive*. Step out to a simpler related problem that isolates it. **Paced** (see §4). | RELAXED about the analog, but REVISE a *premature bridge* (analog + connect-back in one message), a full analog giveaway, or full two-sum code. |
| `scaffold` | Student *has* the concept but can't assemble/express it. Give partial pseudocode with BLANKS to fill. | RELAXED about structure, but REVISE if the skeleton is essentially complete (no blanks left = answer in disguise). |

The MODE line is a control signal — the driver strips it before the student
sees the reply, keeps it in the transcript for teacher continuity, and passes
it to the gate.

---

## 4. De-escalation (the "this student truly can't get it" moment)

Socratic nudging assumes the answer is reachable with a hint. Sometimes it
isn't. Endlessly re-asking is cruel and teaches nothing. When the student is
stuck on the same rung across several escalating hints, the teacher **stops
nudging and changes strategy** — this is `analog` or `scaffold` mode.

**Trigger (must be conservative — under-trigger, never over-trigger).** Real,
repeated, evidenced stuckness, not one "just tell me." The escape hatch must
not become the easy way out.

**Two modes map to WHY the student is stuck:**
- Missing the *concept* -> `analog` (teach the primitive elsewhere, then return)
- Has concept, can't *assemble* -> `scaffold` (faded pseudocode)

**Pacing (mandatory for analog):** the student must ENGAGE with the analog on
its own terms before it's connected back.
1. Present ONLY the simpler puzzle. No mention of the real problem. One question.
2. Light socratic loop on the analog until the student grasps its trick.
3. Only THEN, in a **separate later turn**, bridge back to the real problem.
   NEVER teach the analog and bridge in the same message.

**The return trip is half the value.** Teaching the primitive without
connecting it back leaves the student with a trick and no transfer.

> ⚠️ **De-escalation moves the safety-critical knob from the gate to the
> trigger.** In relaxed modes the gate only floors at "don't dump the full
> answer" — it will NOT catch "de-escalated too eagerly." So the trigger
> threshold is now the primary guard against over-reveal. Recommended: keep the
> trigger conservative and add a soft turn-counter as a *gate on entering*
> de-escalation (e.g. don't de-escalate before ~3 evidenced-stuck exchanges on
> the same rung). Leave the analog itself front-loaded? No — pace it (§4).

---

## 5. What the live runs proved (Two Sum, gpt-5.5 teacher / gpt-5.4-mini gate)

Every scenario below was run end-to-end with a human playing the student.

1. **Happy path.** Teacher walked brute-force -> complexity -> waste -> insight,
   let the student *name* the pattern, then caught the check-before-insert
   ordering bug unprompted (straight from the answer key). Never said "hash map."
2. **Begging.** "Just tell me the answer" -> teacher held the line, escalated to
   a worked example instead of caving.
3. **Wrong path.** Student insisted on sorting -> teacher redirected with a
   counterexample, not a correction. When the student defended a *valid*
   sort-with-indices variant, the teacher **recognized it was actually correct**
   and pivoted to "can you beat O(n log n)?" — i.e. it treats the answer key as
   a map, not gospel. (Flip side: the teacher *can* override the key, so a bad
   key won't always be caught by the teacher — the gate is the backstop.)
4. **Gate teeth.** Probed directly: blatant code leak -> REVISE; the idea in
   plain words with no code and no "hash map" -> REVISE; a legit next-rung nudge
   -> PASS. It discriminates the boundary correctly.
5. **Dense at brute-force rung.** Student didn't know what an index was, gave up,
   self-deprecated. Teacher degraded into ever-smaller micro-steps, reassured,
   switched the example to target=26 so no first-number pair worked (forcing the
   outer-loop concept). Never leaked — because brute force isn't protected.
6. **Dense at the optimization rung -> LEAK CAUGHT.** With the student walling
   every hint, the teacher's draft eventually leaked the destination (described
   a lookup keyed by number). **The gate caught it**, the redraft loop fired for
   the first time, and the second draft was a genuinely better non-leaking move.
   This is the whole reason the two-model architecture exists.
7. **De-escalation + mode-aware gate.** Same stuck student -> teacher judged real
   stuckness, switched to `analog`, generated the coat-check / numbered-hooks
   metaphor (apt isolation of O(1) lookup). The phrase it used would have been a
   LEAK in socratic mode; the gate PASSED it because the teacher *declared*
   analog. Same content, opposite verdict, driven by the shared MODE signal.
8. **Paced analog (enforced).** After tightening: teacher presents the analog
   ALONE, student solves it, THEN the bridge comes in a separate turn. The gate
   PASSES a standalone analog and an earned bridge, and REVISEs a front-loaded
   "analog + bridge in one message" as premature. On breakthrough the teacher
   auto-returns to `socratic`.

**Bottom line:** the core bet held in every scenario, and the architecture
caught itself the one time the teacher was about to fail a student.

---

## 6. Build notes / open questions

- **Latency.** ~15-40s/turn with gpt-5.5 at high reasoning. The teacher doesn't
  need deep reasoning (it has the key) — drop to medium for snappier turns.
- **Gate is a rare safety net, not a per-turn corrector.** A well-prompted,
  grounded teacher self-regulates; the gate passed ~15 real turns and only fired
  on forced/edge cases. Gating every turn is cheap insurance for a personal tool
  though — keep it.
- **Redraft cap.** 1-2 then send best draft. Without it, gate<->teacher can
  oscillate into uselessly-vague and you wait longer for a worse answer.
- **Trigger threshold** is the safety-critical knob now (see §4 warning). Needs
  its own tuning pass; consider the soft turn-counter gate-on-entry.
- **Interaction surface (future).** Chat-only is weak pedagogy. The strong
  version is a Monaco editor center-stage + tutor rail + a "review my code"
  button (AI-initiated critique of the buffer, diagnosing which rung you're on).
  Recommend a **standalone app with embedded Monaco** over a VSCode extension
  for v1 — you need full control of the surface while proving the tutoring
  behavior, and VSCode's culture is optimized to hand people answers. Extension
  is a good v2 distribution play once the behavior is proven.
- **Two AI actions** are different modes: *chat* (student-initiated, reactive,
  meets them where they are) vs *review-my-code* (AI-initiated, diagnoses the
  rung, smallest true nudge). Both bound by the same invariant: never emit a
  working solution to the current problem.
- **Encoding gotcha (real).** codex/CLI demands UTF-8 stdin; Python-on-Windows
  defaults to cp1252 and the em-dashes in the prompts broke it. Force
  `PYTHONUTF8=1` and write intermediate files as UTF-8.
- **Cosmetic:** align the gate's offense enum (`premature-bridge` vs
  `premature-answer`) so telemetry reads consistently.

---

## 7. File manifest (all in the scratchpad — MOVE these)

- `teacher_prompt.md` — the teacher system prompt (Two Sum key filled in, MODE
  output format, de-escalation + pacing rules).
- `gate_prompt.md` — the mode-aware gate prompt ({{mode}}/{{student_msg}}/{{draft}}).
- `drive.sh` — the loop: teacher draft -> parse MODE -> mode-aware gate ->
  redraft-once -> append transcript. Run `bash drive.sh "student message"`.
- `transcript_good.md` — happy-path run.
- `transcript_wrongpath.md` — sorting / wrong-path run.
- `transcript_dense_bruteforce.md` — dense-at-brute-force run.
- `transcript_deescalation.md` — dense-at-insight + de-escalation + paced-analog run.
  (Note: `drive.sh` reads/writes a live `transcript.md` in its own dir; the
  saved runs above are renamed snapshots.)

Templating pipeline (see §8):
- `schema.json` — JSON Schema for a per-problem "problem card".
- `ingest_prompt.md` — statement -> problem card (used with codex `--output-schema`).
- `gate_tmpl.md` — problem-agnostic gate; fills `leak_terms`/insight/optimal from a card.
- `cards/*.card.json` — generated, code-verified cards (two_sum, container_water, house_robber).

---

## 8. Templating — VALIDATED (2026-07-08)

Goal: make the Two-Sum-specific prototype problem-agnostic. Clean split:
FIXED template (teaching philosophy, generic ladder, MODE dial, de-escalation,
gate policy-by-mode) + a PER-PROBLEM **problem card** (JSON) injected into slots.

**Pipeline:** fetch statement -> big model generates the card (strict JSON via
codex `--output-schema schema.json`) -> **verify by EXECUTION**: run the card's
`optimal.code` against its own `examples`; only trust a card whose reference
solution actually passes. Turns "trust the LLM" into grounding, and gives a
natural ingest quality gate (bad card = don't let the student start).

**Card fields:** statement, constraints, brute_force, optimal{approach,code,...},
key_insight, ladder, traps[{wrong,why,counterexample}], leak_terms[],
underlying_primitive, examples[]. The card is a *pedagogical map*, not just a
solution — the insight drives nudges, the traps drive "make the flaw visible"
moves, `leak_terms` drives the gate.

**Learned:** the ladder is generic; only the FACTS are per-problem. Keep ONE
high-altitude ladder in the teacher template (avoid array-flavored phrasing like
"wasteful rescanning"; "redundant work / better structure" generalizes).

**Results — generated cards match/beat the hand-written Two Sum key, across the
three hardest-to-generalize shapes:**
| Problem | Type | Code verified | leak_terms captured |
|---|---|---|---|
| Two Sum | hashing | PASS | DS name + "store seen values" (plain-words) |
| Container With Most Water | two-pointer | PASS | technique name + "move the shorter line" |
| House Robber | DP | PASS | technique name + **the recurrence in plain words** |

The DP case was the real risk (leak surface is a recurrence, not a name). The
generated `leak_terms` captured "max of previous best and two-back best plus
current" etc., with NO generic vocab. Fed into `gate_tmpl.md`, the gate then
REVISE'd a plain-words recurrence leak and PASSED a legit rob-or-skip nudge —
i.e. generated leak_terms give the gate the same teeth as the hand-written list.

### The leak_terms UNLOCK (decided, not yet built)
A leak term should become ALLOWED once the student OWNS that idea as their own
direction — but IFF they *committed* to it, not merely mentioned it (a fishing
"is it a hash map?" must NOT unlock, or one leading question breaks withholding).
Design decided:
- **Deterministic state, not a gate context-window.** `leak_terms` is a mutable
  set; unlocking is monotonic (once unlocked, stays), inspectable, and keeps the
  gate STATELESS (it just reads the current set). Preferred over feeding the gate
  a rolling transcript.
- **A separate narrow "unlock judge"** makes the commit-vs-fish call and triggers
  the mutation — NOT the teacher (the teacher is the policed party; if it unlocks
  its own constraints the gate goes toothless and the leading-question exploit
  reopens). Cheap: prefilter to only run when the student's message touches a
  still-locked concept.
- Orthogonal to `wrong-endorsement`: unlocking vocabulary never means blessing a
  wrong plan — that rule stays in the gate.
- Reframe: an unlocked term == "the student crossed the finish line on that idea."
  That "arrival" signal likely wants to exist once and feed several consumers
  (ladder advance, easing off, UI "you're close"), not be leak-terms-only.

### Build status — DONE (headless engine, `engine/`, 2026-07-08)
All of the below shipped as a TypeScript engine (Increments 1–5). A UI can sit
on `TutorSession`. Implemented by Grok 4.5 under diff-level review.
1. ✅ Templatized TEACHER prompt (card slots) — `prompts/teacher_tmpl.md`.
2. ✅ Unlock judge + deterministic `leak_terms` mutation — `unlockJudge.ts` +
   `session.ts` (prefilter → judge → mutate BEFORE the teacher turn).
3. ✅ Live LeetCode fetch (GraphQL) — `leetcode.ts`; URL → statement → ingest.
4. ✅ Pressure-tested the DE-ESCALATION trigger — results below.

### DE-ESCALATION trigger — pressure-test results (engine, `probes/deescalation.ts`)
The one safety-critical behavior the gate can't backstop. Ran three student
personas through a real `TutorSession` on Two Sum:

| Persona | Description | Modes per turn | Verdict |
|---|---|---|---|
| borderline | stuck-but-progressing (brute force → complexity → "keep track") | socratic ×6 (reproduced twice) | correctly did NOT de-escalate |
| plateau | competent, circles on the insight, no giveup | socratic 1–3, **analog @4** | fires after ~3 stuck exchanges (per design) |
| hopeless | never grasps the problem, gives up | socratic 1–4, **analog @5** | fires at the giveup |

The trigger discriminates: it ignores mild stuckness while the student moves,
and fires only on genuine plateau (~3 evidenced-stuck exchanges) or giveup —
the intended threshold. It also selects the analog to fit WHERE the student is
stuck (basic-search for the hopeless student; badge→seat KEYING for the plateau
student, who only lacks the O(1)-lookup primitive). The gate's redraft also
fired live during the plateau run (caught a leak mid-session). Caveat: n=1–2
runs/persona with model non-determinism; the plateau de-escalation point may
vary ±1 turn. `probes/deescalation.ts` is the kept regression harness.
