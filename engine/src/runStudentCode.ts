import type { CaseSpec } from './exampleCases.js';
import type { Judge } from './types.js';
import { runCsharp } from './run/csharp.js';
import { detectEntryPoint } from './run/entry.js';
import { runPython } from './run/python.js';
import { runTsJs } from './run/typescript.js';
import type { RunnableLang, RunCaseResult, StudentRunResult } from './run/types.js';

export type { RunCaseResult, StudentRunResult };

export async function runStudentCode(
  code: string,
  language: RunnableLang,
  cases: CaseSpec[],
  scaffold?: string,
  judge?: Judge,
): Promise<StudentRunResult> {
  const entry = detectEntryPoint(code, language, scaffold);
  if (!entry) {
    return { cases: [], error: 'could not find your function' };
  }

  try {
    if (language === 'python') return await runPython(code, entry, cases, judge);
    if (language === 'typescript' || language === 'javascript') {
      return await runTsJs(code, entry, cases, language, judge);
    }
    return await runCsharp(code, entry, cases, judge);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { cases: [], error: message };
  }
}
