You are building a tutoring card for a coding problem. The card is primarily
PRIVATE — consumed by a Socratic tutor whose job is to lead a student to the
answer WITHOUT revealing it. Two fields are displayed verbatim to the student:
`statement` and `constraints`. All other answer-key and teaching fields remain
private. Card quality determines how well the tutor can teach, so be a good
teacher, not just a solver.

You are given a problem statement. Produce the card as JSON matching the
provided schema. Guidance per field:

- statement: faithful student-facing problem prose; preserve explicit
  requirements from the source problem; do not add inferred strategies,
  algorithm steps, data structures, or solution hints.
- constraints: student-facing input/domain limits and explicit requirements
  from the source problem only. Never include derived implementation advice,
  algorithm steps, suggested complexity, data structures, or explanations of
  how to satisfy a requirement. Put those ideas in the existing private fields
  (`brute_force`, `optimal`, `key_insight`, `ladder`, `traps`, `leak_terms`)
  instead.
- brute_force: the simplest CORRECT approach a beginner would try first, with
  honest time/space. Most learning starts here — make it real, not a strawman.
- optimal: the intended efficient solution. `code` must be a COMPLETE, RUNNABLE
  reference (define a clearly named entrypoint function) — it will be executed
  against `examples` to verify correctness. Prefer python.
- key_insight: the ONE realization that turns brute force into optimal, stated
  plainly. This is what the tutor steers toward — get it exactly right.
- ladder: 4-7 short phrases naming the rungs from naive to optimal FOR THIS
  problem (e.g. "restate", "brute force", "cost of brute force", "the wasteful
  step", "the insight", "express it"). A map, not a script.
- traps: the 2-4 wrong turns real students take, each with why it's wrong and a
  concrete counterexample input where possible. These let the tutor make a
  flaw visible instead of just correcting it.
- leak_terms: the terms/short phrases that would GIVE AWAY the key insight or
  the specific technique/data structure. Think: "if the tutor said this, the
  student would no longer have to think." Include the pattern/DS name AND the
  insight phrased in plain words (both are leaks). CRITICAL: these must be
  SPECIFIC to this problem's destination. NEVER include generic programming
  vocabulary ("array", "index", "loop", "variable", "return") — that would make
  the tutor unable to say anything. If in doubt whether a term is a leak, ask:
  "does knowing this word collapse the puzzle?" Only then include it.
- underlying_primitive: the core concept the student must possess to get the
  insight, phrased so a tutor could pick an everyday analogy if the student
  lacks it entirely (e.g. "O(1) membership/lookup by key").
- examples: 2-3 worked examples as calls to your reference entrypoint with
  expected outputs as Python literals. These verify the code.

Output ONLY the JSON card. No prose, no code fences.
