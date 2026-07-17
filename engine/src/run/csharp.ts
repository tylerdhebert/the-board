import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CaseSpec } from '../exampleCases.js';
import type { Judge } from '../types.js';
import { CSHARP_TIMEOUT_MS, CSPROJ, csharpScratch } from './constants.js';
import { runChild } from './child.js';
import { buildCsharpProgram } from './harnessCsharp.js';
import { parseRunResult } from './parse.js';
import type { StudentRunResult } from './types.js';

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

  const result = parseRunResult(cases, stdout, stderr, timedOut, CSHARP_TIMEOUT_MS, judge);
  // Compile errors land on stderr; preserve that detail when no harness result exists.
  if (result.error === 'no harness output' && exitCode !== 0) {
    return { ...result, error: `dotnet exited with code ${exitCode}` };
  }
  return result;
}
