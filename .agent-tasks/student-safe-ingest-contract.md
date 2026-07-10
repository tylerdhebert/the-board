# Student-safe ingest contract

Fix the mismatch where the ingest prompt says the entire card is private even though `statement` and `constraints` are sent verbatim to the student.

## Ground rules

- Do not run `tyler-review` or launch an auxiliary reviewer.
- Preserve all existing dirty implementation work.
- Edit only `prompts/ingest_prompt.md`, `schema.json`, and the `constraints` string in each tracked `cards/*.card.json` file that needs cleanup.
- Do not alter statements, answer keys, examples, snippets, formatting beyond what the JSON edit requires, or any runtime code.
- Do not commit.

## Ingest prompt contract

Rewrite the opening so it accurately says:

- The tutoring card is primarily private.
- `statement` and `constraints` are displayed verbatim to the student.
- All other answer-key/teaching fields remain private.

Add explicit field guidance for both student-visible fields:

- `statement`: faithful student-facing problem prose; preserve explicit requirements from the source problem; do not add inferred strategies, algorithm steps, data structures, or solution hints.
- `constraints`: student-facing input/domain limits and explicit requirements from the source problem only. Never include derived implementation advice, algorithm steps, suggested complexity, data structures, or explanations of how to satisfy a requirement. Put those ideas in the existing private fields (`brute_force`, `optimal`, `key_insight`, `ladder`, `traps`, `leak_terms`) instead.

Keep the documentation affirmative and current. Do not add historical/contrastive commentary.

## Schema descriptions

Update the `statement` and `constraints` property descriptions in `schema.json` to state that they are student-visible verbatim and follow the same no-derived-hints rule. Do not change validation shape or required fields.

## Bundled cards

These tracked cards are loaded directly as built-in product data, so clean their `constraints` strings. Preserve only actual input/domain bounds and explicit problem requirements. Remove inferred complexity guidance or solution steps.

Use these intended meanings:

- `container_water.card.json`: retain `2 <= n <= 100000; 0 <= height[i] <= 10000.`
- `house_robber.card.json`: retain `1 <= nums.length <= 100; 0 <= nums[i] <= 400.`
- `longest-common-prefix.card.json`: retain the three input/string constraints; remove the sentence about O(n*m) scans.
- `reverse-integer.card.json`: retain the signed 32-bit range, the explicit rule that out-of-range reversed values return 0, and that 64-bit intermediate values are unavailable. Remove the multiply-by-10/add and pre-overflow-check strategy.
- `same-tree.card.json`: retain node-count and node-value bounds; remove the traversal-complexity advice.
- `two_sum.card.json`: retain list/value bounds, exactly one valid answer, and the distinct-element rule; remove O(n^2)/O(n) guidance.
- `valid-parentheses.card.json`: retain length and allowed-character constraints; remove brute-force/intended-complexity guidance.

Use concise natural wording consistent with each existing card. Do not sanitize private fields; they are supposed to contain the teaching strategy and answer key.

## Verification

- Parse every tracked `cards/*.card.json` and `schema.json` as JSON.
- Search the resulting bundled `constraints` strings and confirm none contains algorithm steps, data structures, `O(...)` guidance, or derived solution advice.
- Run `git diff --check`.
- Report changed files and verification results.
