import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LLMClient } from './llm.js';
import { PROMPTS_DIR } from './paths.js';
import { bullets, fillTemplate, renderTranscript } from './render.js';
import type { Message, ProblemCard, TutorMode } from './types.js';

export interface TeacherReply { mode: TutorMode; reply: string; raw: string }

/** Optional per-turn board context for the teacher (cwd + already-rendered lines). */
export interface TeacherTurnContext {
  cwd?: string;
  boardContext?: string;
}

export async function teacherTurn(
  client: LLMClient, card: ProblemCard, transcript: Message[],
  lockedTerms: string[], model: string,
  gateFeedback?: { rejectedDraft: string; note: string },
  turnContext?: TeacherTurnContext,
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
  const gate_feedback = gateFeedback === undefined
    ? ''
    : `Your previous draft was REJECTED by the safety gate for: ${gateFeedback.note}\nRejected draft:\n${gateFeedback.rejectedDraft}\nRewrite it to satisfy the gate (reveal LESS, or switch mode if that is the right move).`;
  const board_context = turnContext?.boardContext?.trim()
    ? `${turnContext.boardContext.trim()}\n`
    : '';
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
    board_context,
    transcript: renderTranscript(transcript),
    gate_feedback,
  });

  const raw = await client.complete({
    model,
    prompt,
    label: 'teacher',
    ...(turnContext?.cwd ? { cwd: turnContext.cwd } : {}),
  });

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
