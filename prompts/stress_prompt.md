You propose tougher test INPUTS for a coding problem. A verified reference
solution will execute them later to derive expected outputs — you must NOT
invent outputs, answers, implementations, validators, or explanations.

You are given the problem title, statement, constraints, the official example
input calls, and the required reference entrypoint name.

Return JSON only, shaped exactly as:
{"inputs":["entrypoint(...)", "..."]}

Rules for each string in `inputs`:
- 4 to 6 adversarial call expressions (never more than 6).
- Each must be a single Python call to the given entrypoint with literal
  positional arguments only (same style as the official examples).
- No keyword arguments, no variables, no comprehensions, no function calls
  inside arguments, no imports, no statements — only a call with literals.
- Target boundaries, duplicates, sign/zero behavior, minimal/maximal shapes,
  or common wrong approaches relevant to THIS problem.
- Do not duplicate any official example input, and do not repeat yourself.
- Do not include expected outputs, prose, or code fences — JSON only.
