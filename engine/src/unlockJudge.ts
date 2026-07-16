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

  const parsed = await completeJson<UnlockResult>(client, { model, prompt, label: 'unlock' });
  return sanitizeUnlockResult(parsed, lockedTerms);
}

/**
 * Direct-mode bookkeeping: which locked terms did this off-the-record turn
 * actually surface (by either party)? Keeps later socratic turns from
 * pretending the student never heard what the tutor just said openly.
 */
export async function judgeReveal(
  client: LLMClient, lockedTerms: string[], studentMsg: string,
  tutorReply: string, model: string,
): Promise<UnlockResult> {
  if (lockedTerms.length === 0) {
    return { unlocked: [], reason: 'no locked terms' };
  }

  const tpl = await readFile(join(PROMPTS_DIR, 'reveal_tmpl.md'), 'utf-8');
  const prompt = fillTemplate(tpl, {
    leak_terms: bullets(lockedTerms),
    student_msg: studentMsg,
    tutor_reply: tutorReply,
  });

  const parsed = await completeJson<UnlockResult>(client, { model, prompt, label: 'unlock' });
  return sanitizeUnlockResult(parsed, lockedTerms);
}

// Guard against off-schema model output (completeJson does not validate shape).
function sanitizeUnlockResult(parsed: UnlockResult, lockedTerms: string[]): UnlockResult {
  const lockedSet = new Set(lockedTerms);
  const returned = Array.isArray(parsed.unlocked) ? parsed.unlocked : [];
  const unlocked = returned.filter((term) => lockedSet.has(term));
  return { unlocked, reason: typeof parsed.reason === 'string' ? parsed.reason : '' };
}
