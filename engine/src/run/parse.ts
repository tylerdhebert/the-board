import type { CaseSpec } from '../exampleCases.js';
import type { Judge } from '../types.js';
import { compareGot } from './compare.js';
import { lastJsonLine } from './child.js';
import { CASE_SENTINEL } from './console.js';
import type { ConsoleBlock, HarnessPayload, RunCaseResult, StudentRunResult } from './types.js';

const STDOUT_CAP = 20_000;
const TRUNCATED_OUTPUT = '\n… output truncated';
const CASE_SENTINEL_LINE = new RegExp(`^${CASE_SENTINEL}(\\d+)__$`, 'gm');

function trimChunk(chunk: string, afterSentinel: boolean): string | undefined {
  const withoutMarkerNewline = afterSentinel ? chunk.replace(/^\n/, '') : chunk;
  const trimmed = withoutMarkerNewline.trimEnd();
  return trimmed.trim() ? trimmed : undefined;
}

/** Split direct stdout into a module-load block and one block per emitted case sentinel. */
export function consoleBlocks(cases: CaseSpec[], output: string): ConsoleBlock[] | undefined {
  const normalized = output.replace(/\r\n?/g, '\n');
  const matches = [...normalized.matchAll(CASE_SENTINEL_LINE)];
  const chunks: { index?: number; text: string; afterSentinel: boolean }[] = [];

  if (matches.length === 0) {
    chunks.push({ text: normalized, afterSentinel: false });
  } else {
    chunks.push({ text: normalized.slice(0, matches[0]!.index), afterSentinel: false });
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i]!;
      const next = matches[i + 1];
      chunks.push({
        index: Number(match[1]),
        text: normalized.slice(match.index! + match[0].length, next?.index),
        afterSentinel: true,
      });
    }
  }

  const blocks: ConsoleBlock[] = [];
  let remaining = STDOUT_CAP;
  for (const chunk of chunks) {
    const text = trimChunk(chunk.text, chunk.afterSentinel);
    if (!text || remaining <= 0) continue;
    const label = chunk.index === undefined
      ? undefined
      : cases[chunk.index]?.display ?? `case ${chunk.index + 1}`;
    if (text.length <= remaining) {
      blocks.push({ ...(label ? { label } : {}), text });
      remaining -= text.length;
      continue;
    }
    const prefixLength = Math.max(0, remaining - TRUNCATED_OUTPUT.length);
    blocks.push({
      ...(label ? { label } : {}),
      text: text.slice(0, prefixLength) + TRUNCATED_OUTPUT.slice(0, remaining - prefixLength),
    });
    break;
  }
  return blocks.length ? blocks : undefined;
}

function isHarnessShaped(value: unknown): boolean {
  return typeof value === 'object' && value !== null && ('results' in value || 'fatal' in value);
}

/** Everything before the final harness JSON trailer belongs to the student. */
export function studentStdout(stdout: string, timedOut = false): string | undefined {
  const lines = stdout.split(/\r?\n/);
  let harnessLine = -1;
  // A timed-out run was killed before the harness could print its trailer, so
  // a JSON-looking final line is student output (e.g. print('{"x": 1}') then an
  // infinite loop) — strip nothing. Otherwise only strip a harness-shaped line,
  // not any JSON (a bare `print(42)` parses as JSON too).
  if (!timedOut) {
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line?.trim()) continue;
      try {
        if (isHarnessShaped(JSON.parse(line))) harnessLine = i;
      } catch {
        // The last non-empty line is not a harness payload, so all stdout is student output.
      }
      break;
    }
  }
  const student = harnessLine === -1 ? stdout : lines.filter((_, i) => i !== harnessLine).join('\n');
  return student.trimEnd() || undefined;
}

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

export function parseRunResult(
  cases: CaseSpec[],
  stdout: string,
  stderr: string,
  timedOut: boolean,
  timeoutMs: number,
  judge?: Judge,
): StudentRunResult {
  const result = toRunResult(cases, parseHarness(stdout, stderr, timedOut, timeoutMs), judge);
  const output = studentStdout(stdout, timedOut);
  const console = output ? consoleBlocks(cases, output) : undefined;
  return console ? { ...result, console } : result;
}
