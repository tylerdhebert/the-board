import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stripFigureRefs } from './leetcode.js';
import { completeJson, type LLMClient } from './llm.js';
import { PROMPTS_DIR } from './paths.js';
import type { Example, ProblemCard } from './types.js';
import { detectEntrypoint } from './stress/entrypoint.js';
import { oracleOne } from './stress/oracle.js';
import { MAX_STRESS, parseInputsPayload } from './stress/payload.js';

/**
 * LLM proposes adversarial input calls only; expected outputs come from
 * executing the card's verified Python reference (one short-timeout child each).
 */
export async function generateStressCases(
  client: LLMClient,
  card: ProblemCard,
  model: string,
): Promise<Example[]> {
  if (!card.optimal.language.toLowerCase().includes('python')) {
    throw new Error(
      `stress cases require a Python reference (got "${card.optimal.language}")`,
    );
  }
  if (!card.examples?.length) {
    throw new Error('card has no official examples');
  }

  const entrypoint = await detectEntrypoint(card.examples);
  const basePrompt = await readFile(join(PROMPTS_DIR, 'stress_prompt.md'), 'utf-8');
  const officialInputs = card.examples.map((e) => e.input.trim());
  const prompt =
    basePrompt +
    `\n\n## TITLE\n${card.title}` +
    `\n\n## STATEMENT\n${stripFigureRefs(card.statement)}` +
    `\n\n## CONSTRAINTS\n${card.constraints}` +
    `\n\n## ENTRYPOINT\n${entrypoint}` +
    `\n\n## OFFICIAL EXAMPLE INPUTS\n` +
    officialInputs.map((s) => `- ${s}`).join('\n');

  const raw = await completeJson<unknown>(client, {
    model,
    prompt,
    label: 'stress',
  });

  let proposals = parseInputsPayload(raw)
    .map((s) => s.trim())
    .filter(Boolean);
  if (proposals.length === 0) {
    throw new Error('stress generation returned no input strings');
  }
  proposals = proposals.slice(0, MAX_STRESS);

  const officialSet = new Set(officialInputs);
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const p of proposals) {
    if (officialSet.has(p) || seen.has(p)) continue;
    seen.add(p);
    unique.push(p);
  }

  const rows: Example[] = [];
  for (const input of unique) {
    const result = await oracleOne(card.optimal.code, entrypoint, input, card.judge);
    if (!result.ok) continue;
    rows.push({ input, output: result.output });
  }

  if (rows.length === 0) {
    throw new Error(
      'no valid tougher cases survived validation/oracle (all proposals were dropped)',
    );
  }
  return rows;
}
