import type { CaseSpec } from '../exampleCases.js';
import type { Judge } from '../types.js';
import { compareGot } from './compare.js';
import { lastJsonLine } from './child.js';
import type { HarnessPayload, RunCaseResult, StudentRunResult } from './types.js';

export function parseHarness(stdout: string, stderr: string, timedOut: boolean, timeoutMs: number): HarnessPayload {
  if (timedOut) {
    return { fatal: `timed out after ${timeoutMs / 1000}s (infinite loop?)` };
  }
  const line = lastJsonLine(stdout);
  if (!line) {
    const errLines = stderr.trim().split(/\r?\n/).filter(Boolean).slice(0, 10).join('\n');
    return { fatal: errLines || 'no harness output' };
  }
  try {
    return JSON.parse(line) as HarnessPayload;
  } catch {
    const errLines = stderr.trim().split(/\r?\n/).filter(Boolean).slice(0, 10).join('\n');
    return { fatal: errLines || `unparseable harness output: ${line.slice(0, 200)}` };
  }
}

export function toRunResult(cases: CaseSpec[], payload: HarnessPayload, judge?: Judge): StudentRunResult {
  if ('fatal' in payload) {
    return { cases: [], error: payload.fatal };
  }
  const results = payload.results ?? [];
  const out: RunCaseResult[] = cases.map((c, i) => {
    const r = results[i];
    const expectedStr = JSON.stringify(c.expected);
    const stressMark = c.stress ? ({ stress: true } as const) : ({ stress: false } as const);
    if (!r) {
      return {
        display: c.display,
        expected: expectedStr,
        got: 'null',
        pass: false,
        error: 'missing result',
        ...stressMark,
      };
    }
    if (r.error != null) {
      return {
        display: c.display,
        expected: expectedStr,
        got: 'null',
        pass: false,
        error: r.error,
        ...stressMark,
      };
    }
    // Judged (in-place / k-prefix) cases extract got from args; null return is fine.
    if (!judge && (r.got === null || r.got === undefined) && c.expected !== null) {
      return {
        display: c.display,
        expected: expectedStr,
        got: 'null',
        pass: false,
        error:
          "got nothing back — did you return the result? (in-place/mutation problems aren't supported yet)",
        ...stressMark,
      };
    }
    const pass = compareGot(r.got, c.expected, judge);
    return {
      display: c.display,
      expected: expectedStr,
      got: JSON.stringify(r.got),
      pass,
      ...stressMark,
    };
  });
  return { cases: out };
}
