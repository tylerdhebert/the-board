import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LLMClient } from './llm.js';
import { PROMPTS_DIR } from './paths.js';
import { bullets, fillTemplate, renderTranscript } from './render.js';
import type { Message, ProblemCard, TutorMode } from './types.js';

export interface TeacherReply { mode: TutorMode; reply: string; raw: string }

export async function teacherTurn(
  client: LLMClient, card: ProblemCard, transcript: Message[],
  lockedTerms: string[], model: string,
): Promise<TeacherReply> {
  const tpl = await readFile(join(PROMPTS_DIR, 'teacher_tmpl.md'), 'utf-8');
  const traps = bullets(
    card.traps.map((t) => {
      let line = `${t.wrong_approach} — ${t.why_wrong}`;
      if (t.counterexample !== '') {
        line += ` (e.g. ${t.counterexample})`;
      }
      return line;
    }),
  );
  const prompt = fillTemplate(tpl, {
    title: card.title,
    statement: card.statement,
    constraints: card.constraints,
    brute_force: `${card.brute_force.approach} (${card.brute_force.time}, ${card.brute_force.space})`,
    optimal: `${card.optimal.approach} (${card.optimal.time}, ${card.optimal.space})`,
    key_insight: card.key_insight,
    underlying_primitive: card.underlying_primitive,
    ladder: card.ladder.join(' -> '),
    traps,
    leak_terms: bullets(lockedTerms),
    transcript: renderTranscript(transcript),
  });

  const raw = await client.complete({ model, prompt });

  const lines = raw.split(/\r?\n/);
  let firstNonEmptyIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.trim() !== '') {
      firstNonEmptyIdx = i;
      break;
    }
  }

  if (firstNonEmptyIdx >= 0) {
    const match = lines[firstNonEmptyIdx]!.match(/^MODE:\s*(socratic|analog|scaffold)\b/i);
    if (match) {
      const mode = match[1]!.toLowerCase() as TutorMode;
      let reply = lines.slice(firstNonEmptyIdx + 1).join('\n');
      reply = reply.replace(/^\s*\n+/, '');
      return { mode, reply, raw };
    }
  }

  return { mode: 'socratic', reply: raw.trim(), raw };
}
