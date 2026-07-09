import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { completeJson, type LLMClient } from './llm.js';
import { PROMPTS_DIR } from './paths.js';
import { bullets, fillTemplate } from './render.js';

export interface UnlockResult { unlocked: string[]; reason: string }

export async function judgeUnlock(
  client: LLMClient, lockedTerms: string[], prevTeacher: string,
  studentMsg: string, model: string,
): Promise<UnlockResult> {
  if (lockedTerms.length === 0) {
    return { unlocked: [], reason: 'no locked terms' };
  }

  const tpl = await readFile(join(PROMPTS_DIR, 'unlock_tmpl.md'), 'utf-8');
  const prompt = fillTemplate(tpl, {
    leak_terms: bullets(lockedTerms),
    prev_teacher: prevTeacher,
    student_msg: studentMsg,
  });

  const parsed = await completeJson<UnlockResult>(client, { model, prompt });
  const lockedSet = new Set(lockedTerms);
  // Guard against off-schema model output (completeJson does not validate shape).
  const returned = Array.isArray(parsed.unlocked) ? parsed.unlocked : [];
  const unlocked = returned.filter((term) => lockedSet.has(term));
  return { unlocked, reason: typeof parsed.reason === 'string' ? parsed.reason : '' };
}
