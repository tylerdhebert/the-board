import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CaseSpec } from '../exampleCases.js';
import type { Judge } from '../types.js';
import { CSHARP_TIMEOUT_MS, CSPROJ, csharpScratch } from './constants.js';
import { lastJsonLine, runChild } from './child.js';
import { buildCsharpProgram } from './harnessCsharp.js';
import { parseHarness, toRunResult } from './parse.js';
import type { HarnessPayload, StudentRunResult } from './types.js';

async function ensureCsharpScratch(): Promise<void> {
  const scratch = csharpScratch();
  await mkdir(scratch, { recursive: true });
  await writeFile(join(scratch, 'run.csproj'), CSPROJ, 'utf8');
}

export async function runCsharp(
  code: string,
  entry: string,
  cases: CaseSpec[],
  judge?: Judge,
): Promise<StudentRunResult> {
  await ensureCsharpScratch();
  const scratch = csharpScratch();
  const programPath = join(scratch, 'Program.cs');
  const casesPath = join(scratch, 'cases.json');
  await writeFile(casesPath, JSON.stringify(cases.map((c) => c.args)), 'utf8');
  await writeFile(programPath, buildCsharpProgram(code, entry, casesPath, judge), 'utf8');

  const { stdout, stderr, timedOut, code: exitCode } = await runChild(
    'dotnet',
    ['run', '--project', scratch],
    { cwd: scratch, timeoutMs: CSHARP_TIMEOUT_MS },
  );

  if (timedOut) {
    return { cases: [], error: `timed out after ${CSHARP_TIMEOUT_MS / 1000}s (infinite loop?)` };
  }

  const line = lastJsonLine(stdout);
  if (line) {
    try {
      const payload = JSON.parse(line) as HarnessPayload;
      return toRunResult(cases, payload, judge);
    } catch {
      // fall through to stderr fatal
    }
  }

  // Compile errors land on stderr
  if (exitCode !== 0 || !line) {
    const errLines = stderr.trim().split(/\r?\n/).filter(Boolean).slice(0, 10).join('\n');
    return { cases: [], error: errLines || `dotnet exited with code ${exitCode}` };
  }

  return toRunResult(cases, parseHarness(stdout, stderr, false, CSHARP_TIMEOUT_MS), judge);
}
