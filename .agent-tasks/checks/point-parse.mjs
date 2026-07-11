/**
 * Throwaway parse check for POINT gesture control-line parsing.
 * Run from repo root: node --import tsx .agent-tasks/checks/point-parse.mjs
 * Or: cd engine && npx tsx ../.agent-tasks/checks/point-parse.mjs
 */
import { parseTeacherReply } from '../../engine/src/teacher.ts';

function show(label, raw) {
  const r = parseTeacherReply(raw);
  console.log(`\n=== ${label} ===`);
  console.log('raw:', JSON.stringify(raw));
  console.log('mode:', r.mode);
  console.log('point:', r.point ?? null);
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
  `MODE: socratic\nPOINT: 0 | const x = 1;\n\nShould strip POINT, no point field.`,
);

show(
  'POINT with missing pipe',
  `MODE: socratic\nPOINT: 3 const x = 1;\n\nHalf-formed — strip, no point.`,
);

show(
  'no MODE fallback (POINT left in body)',
  `POINT: 2 | return true;\nJust some prose without a MODE line.`,
);

show(
  'POINT with empty quote',
  `MODE: scaffold\nPOINT: 5 |\n\nBlank after pipe — strip, no point.`,
);

show(
  'MODE+POINT scaffold',
  `MODE: scaffold\nPOINT: 12 |   while (left < right) {\n\nFill in the blank inside the loop.`,
);
