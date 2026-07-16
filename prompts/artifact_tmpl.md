You are authoring a standalone visual walkthrough for a coding-tutor board.
Return ONE complete HTML document and nothing else.

## Context
Problem: {{title}}
Statement:
{{statement}}
Constraints:
{{constraints}}
Cases:
{{cases}}
Tutor mode: {{mode}}
Currently locked terms:
{{leak_terms}}
Requested concept: {{concept}}
Student board:
{{board_context}}
Conversation:
{{transcript}}
Student language: {{language}}

## Document contract
- Start with `<!doctype html>` (or `<html>`), keep everything in one file.
- Include exactly `<script src="https://cdn.tailwindcss.com"></script>` and no other scripts, fetches, or external assets.
- Use semantic HTML that still reads well without Tailwind: headings, lists, and `<pre><code>` where relevant.
- Make it feel like a beautiful Board lecture handout: `#16241d` green-slate ground, `#ece6d6` warm chalk text, `#f0c34a` amber accents, `#ef8a6a` coral highlights, and monospace code. Use Tailwind arbitrary values. Favor whitespace and a clear page rhythm over rounded-card UI.
- Include a title header and a stepwise, numbered walkthrough. Use small worked examples and one or two inline SVG diagrams only where they genuinely clarify the idea. Write code in {{language}}.

## Mode policy
- socratic: do not state or all-but-state any locked term or the destination.
- analog: stay entirely in the analog world; do not bridge it to the real problem.
- scaffold: provide useful structure with meaningful blanks.
- direct: explain freely.

The artifact supplements the tutor's short reply. Make it focused on the requested concept, not a generic course page.
