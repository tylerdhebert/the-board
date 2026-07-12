/**
 * Throwaway parse check for gesture control-line parsing (POINT / SHOW / TAP).
 * Run from engine/: npx tsx ../.agent-tasks/checks/point-parse.mjs
 */
import { parseTeacherReply } from '../../engine/src/teacher.ts';

function show(label, raw) {
  const r = parseTeacherReply(raw);
  console.log(`\n=== ${label} ===`);
  console.log('raw:', JSON.stringify(raw));
  console.log('mode:', r.mode);
  console.log('gesture:', r.gesture ?? null);
  console.log('reply:', JSON.stringify(r.reply));
}

show(
  'MODE+POINT (valid)',
  `MODE: socratic\nPOINT: 3 | const x = 1;\n\nLook at that line — what does it do?`,
);

show(
  'MODE only',
  `MODE: analog\n\nImagine a coat check with tickets.`,
);

show(
  'POINT with bad line number',
  `MODE: socratic\nPOINT: 0 | const x = 1;\n\nShould strip POINT, no gesture.`,
);

show(
  'POINT with missing pipe',
  `MODE: socratic\nPOINT: 3 const x = 1;\n\nHalf-formed — strip, no gesture.`,
);

show(
  'no MODE fallback (POINT left in body)',
  `POINT: 2 | return true;\nJust some prose without a MODE line.`,
);

show(
  'POINT with empty quote',
  `MODE: scaffold\nPOINT: 5 |\n\nBlank after pipe — strip, no gesture.`,
);

show(
  'MODE+POINT scaffold',
  `MODE: scaffold\nPOINT: 12 |   while (left < right) {\n\nFill in the blank inside the loop.`,
);

show(
  'POINT range 5-8 (valid, endLine)',
  `MODE: socratic\nPOINT: 5-8 | while (left < right) {\n\nThis whole block is the loop body.`,
);

show(
  'POINT range 5-5 (collapses to single line, no endLine)',
  `MODE: socratic\nPOINT: 5-5 | return mid;\n\nSame as a plain point.`,
);

show(
  'POINT backwards range 8-5 (invalid — strip, no gesture)',
  `MODE: socratic\nPOINT: 8-5 | return mid;\n\nEnd before start — drop it.`,
);

show(
  'SHOW: case 3 (valid)',
  `MODE: socratic\nSHOW: case 3\n\nTry this input — what happens?`,
);

show(
  'SHOW: 2 shorthand',
  `MODE: socratic\nSHOW: 2\n\nSame idea, shorter form.`,
);

show(
  'SHOW with garbage number',
  `MODE: socratic\nSHOW: case 0\n\nOut of range at parse — strip, no gesture.`,
);

show(
  'SHOW with non-numeric',
  `MODE: socratic\nSHOW: case abc\n\nGarbage — strip, no gesture.`,
);

show(
  'TAP: vocab (valid)',
  `MODE: socratic\nTAP: vocab\n\nThere's a word for what you just said.`,
);

show(
  'TAP bare',
  `MODE: analog\nTAP:\n\nTapping the board.`,
);

show(
  'TAP with trailing junk',
  `MODE: socratic\nTAP: something-else\n\nJunk payload — strip, no gesture.`,
);

show(
  'SHOW after POINT (first consumed, second left in body)',
  `MODE: socratic\nPOINT: 1 | return 0;\nSHOW: case 2\n\nOnly the first gesture counts.`,
);
