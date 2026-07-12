import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stripFigureRefs } from './leetcode.js';
import type { LLMClient } from './llm.js';
import { PROMPTS_DIR } from './paths.js';
import { bullets, fillTemplate, renderTranscript } from './render.js';
import type { Message, ProblemCard, TutorMode } from './types.js';

export type TeacherGesture =
  | { kind: 'point'; line: number; quote: string }
  | { kind: 'show'; caseNumber: number }
  | { kind: 'tap' };

export interface TeacherReply {
  mode: TutorMode;
  reply: string;
  raw: string;
  gesture?: TeacherGesture;
}

/** Optional per-turn board context for the teacher (cwd + already-rendered lines). */
export interface TeacherTurnContext {
  cwd?: string;
  boardContext?: string;
}

const POINT_RE = /^POINT:\s*(\d+)\s*\|\s*(.+)$/i;
const SHOW_RE = /^SHOW:\s*(?:case\s+)?(\d+)\s*$/i;
const TAP_RE = /^TAP:\s*(?:vocab)?\s*$/i;
const GESTURE_LOOKS_RE = /^(POINT|SHOW|TAP):/i;

function parseGestureLine(line: string): TeacherGesture | undefined {
  const pointMatch = line.match(POINT_RE);
  if (pointMatch) {
    const lineNum = Number(pointMatch[1]);
    const quote = pointMatch[2]!.trim();
    if (Number.isInteger(lineNum) && lineNum > 0 && quote !== '') {
      return { kind: 'point', line: lineNum, quote };
    }
    return undefined;
  }

  const showMatch = line.match(SHOW_RE);
  if (showMatch) {
    const caseNumber = Number(showMatch[1]);
    if (Number.isInteger(caseNumber) && caseNumber >= 1) {
      return { kind: 'show', caseNumber };
    }
    return undefined;
  }

  if (TAP_RE.test(line)) {
    return { kind: 'tap' };
  }

  return undefined;
}

/** Numbered case list for the teacher prompt (officials first, then tougher). */
export function renderCases(card: ProblemCard): string {
  const lines: string[] = [];
  let n = 1;
  for (const ex of card.examples) {
    lines.push(`${n}. ${ex.input} -> ${ex.output}`);
    n++;
  }
  for (const ex of card.stress ?? []) {
    lines.push(`${n}. ${ex.input} -> ${ex.output} (tougher)`);
    n++;
  }
  return lines.length === 0 ? '(none)' : lines.join('\n');
}

/**
 * Pure parser for teacher raw output: MODE line, optional gesture control
 * line, then prose. Used by teacherTurn and unit-driven by the parse check.
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
    // No MODE — fallback replies stay as-is; do not attempt gesture parsing.
    return { mode: 'socratic', reply: raw.trim(), raw };
  }

  const mode = match[1]!.toLowerCase() as TutorMode;
  let bodyStart = firstNonEmptyIdx + 1;
  let gesture: TeacherGesture | undefined;

  // Next non-empty line may be ONE gesture control line.
  let nextNonEmptyIdx = -1;
  for (let i = bodyStart; i < lines.length; i++) {
    if (lines[i]!.trim() !== '') {
      nextNonEmptyIdx = i;
      break;
    }
  }

  if (nextNonEmptyIdx >= 0 && GESTURE_LOOKS_RE.test(lines[nextNonEmptyIdx]!)) {
    gesture = parseGestureLine(lines[nextNonEmptyIdx]!);
    // Strip the control line whether or not it validated — half-formed
    // control lines must never reach the student.
    bodyStart = nextNonEmptyIdx + 1;
  }

  let reply = lines.slice(bodyStart).join('\n');
  reply = reply.replace(/^\s*\n+/, '');
  return gesture ? { mode, reply, raw, gesture } : { mode, reply, raw };
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
    statement: stripFigureRefs(card.statement),
    constraints: card.constraints,
    brute_force: `${card.brute_force.approach} (${card.brute_force.time}, ${card.brute_force.space})`,
    optimal: `${card.optimal.approach} (${card.optimal.time}, ${card.optimal.space})`,
    key_insight: card.key_insight,
    underlying_primitive: card.underlying_primitive,
    ladder: card.ladder.join(' -> '),
    traps,
    leak_terms: bullets(lockedTerms),
    cases: renderCases(card),
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
