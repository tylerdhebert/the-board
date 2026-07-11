import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LLMClient } from './llm.js';
import { PROMPTS_DIR } from './paths.js';
import { bullets, fillTemplate, renderTranscript } from './render.js';
import type { Message, ProblemCard, TutorMode } from './types.js';

export interface TeacherReply {
  mode: TutorMode;
  reply: string;
  raw: string;
  point?: { line: number; quote: string };
}

/** Optional per-turn board context for the teacher (cwd + already-rendered lines). */
export interface TeacherTurnContext {
  cwd?: string;
  boardContext?: string;
}

const POINT_RE = /^POINT:\s*(\d+)\s*\|\s*(.+)$/i;
const POINT_LOOKS_RE = /^POINT:/i;

/**
 * Pure parser for teacher raw output: MODE line, optional POINT gesture,
 * then prose. Used by teacherTurn and unit-driven by the parse check.
 */
export function parseTeacherReply(raw: string): TeacherReply {
  const lines = raw.split(/\r?\n/);
  let firstNonEmptyIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.trim() !== '') {
      firstNonEmptyIdx = i;
      break;
    }
  }

  if (firstNonEmptyIdx < 0) {
    return { mode: 'socratic', reply: raw.trim(), raw };
  }

  const match = lines[firstNonEmptyIdx]!.match(/^MODE:\s*(socratic|analog|scaffold)\b/i);
  if (!match) {
    // No MODE — fallback replies stay as-is; do not attempt POINT parsing.
    return { mode: 'socratic', reply: raw.trim(), raw };
  }

  const mode = match[1]!.toLowerCase() as TutorMode;
  let bodyStart = firstNonEmptyIdx + 1;
  let point: { line: number; quote: string } | undefined;

  // Next non-empty line may be a POINT gesture control line.
  let nextNonEmptyIdx = -1;
  for (let i = bodyStart; i < lines.length; i++) {
    if (lines[i]!.trim() !== '') {
      nextNonEmptyIdx = i;
      break;
    }
  }

  if (nextNonEmptyIdx >= 0 && POINT_LOOKS_RE.test(lines[nextNonEmptyIdx]!)) {
    const pointMatch = lines[nextNonEmptyIdx]!.match(POINT_RE);
    if (pointMatch) {
      const line = Number(pointMatch[1]);
      const quote = pointMatch[2]!.trim();
      if (Number.isInteger(line) && line > 0 && quote !== '') {
        point = { line, quote };
      }
    }
    // Strip the control line whether or not it validated — half-formed
    // POINT lines must never reach the student.
    bodyStart = nextNonEmptyIdx + 1;
  }

  let reply = lines.slice(bodyStart).join('\n');
  reply = reply.replace(/^\s*\n+/, '');
  return point ? { mode, reply, raw, point } : { mode, reply, raw };
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

  return parseTeacherReply(raw);
}
