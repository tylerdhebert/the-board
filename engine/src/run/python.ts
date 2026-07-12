import type { CaseSpec } from '../exampleCases.js';
import type { Judge } from '../types.js';
import { PYTHON_TIMEOUT_MS } from './constants.js';
import { runChild } from './child.js';
import { buildPythonHarness } from './harnessPython.js';
import { parseHarness, toRunResult } from './parse.js';
import type { StudentRunResult } from './types.js';

export async function runPython(
  code: string,
  entry: string,
  cases: CaseSpec[],
  judge?: Judge,
): Promise<StudentRunResult> {
  const script = buildPythonHarness(code, entry, cases, judge);
  const { stdout, stderr, timedOut } = await runChild('python', ['-'], {
    env: { ...process.env, PYTHONUTF8: '1' },
    stdin: script,
    timeoutMs: PYTHON_TIMEOUT_MS,
  });
  return toRunResult(cases, parseHarness(stdout, stderr, timedOut, PYTHON_TIMEOUT_MS), judge);
}
