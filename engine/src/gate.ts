import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { completeJson, type LLMClient } from './llm.js';
import { PROMPTS_DIR } from './paths.js';
import { bullets, fillTemplate } from './render.js';
import type { GateVerdict, ProblemCard, TutorMode } from './types.js';

export async function gateCheck(
  client: LLMClient, card: ProblemCard, mode: TutorMode,
  studentMsg: string, draft: string, lockedTerms: string[], model: string,
): Promise<GateVerdict> {
  const tpl = await readFile(join(PROMPTS_DIR, 'gate_tmpl.md'), 'utf-8');
  const prompt = fillTemplate(tpl, {
    problem_title: card.title,
    optimal_approach: card.optimal.approach,
    key_insight: card.key_insight,
    leak_terms: bullets(lockedTerms),
    mode,
    student_msg: studentMsg,
    draft,
  });

  const parsed = await completeJson<GateVerdict>(client, { model, prompt, label: 'gate' });
  if (parsed.verdict !== 'PASS' && parsed.verdict !== 'REVISE') {
    throw new Error(`Invalid gate verdict: ${JSON.stringify(parsed.verdict)}`);
  }
  return parsed;
}
