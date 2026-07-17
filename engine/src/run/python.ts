import type { CaseSpec } from '../exampleCases.js';
import type { Judge } from '../types.js';
import { PYTHON_TIMEOUT_MS } from './constants.js';
import { runChild } from './child.js';
import { buildPythonHarness } from './harnessPython.js';
import { parseRunResult } from './parse.js';
import type { StudentRunResult } from './types.js';

export async function runPython(
  code: string,
  entry: string,
  cases: CaseSpec[],
  judge?: Judge,
): Promise<StudentRunResult> {
  const script = buildPythonHarness(code, entry, cases, judge);
  const { stdout, stderr, timedOut } = await runChild('python', ['-'], {
    // Unbuffered so student print()s survive a timeout kill — piped python is
    // block-buffered, and the infinite-loop case is exactly when prints matter.
    env: { ...process.env, PYTHONUTF8: '1', PYTHONUNBUFFERED: '1' },
    stdin: script,
    timeoutMs: PYTHON_TIMEOUT_MS,
  });
  return parseRunResult(cases, stdout, stderr, timedOut, PYTHON_TIMEOUT_MS, judge);
}
