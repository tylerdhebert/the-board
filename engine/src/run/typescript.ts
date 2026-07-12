import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CaseSpec } from '../exampleCases.js';
import type { Judge } from '../types.js';
import { SERVER_DIR, TS_TIMEOUT_MS } from './constants.js';
import { runChild } from './child.js';
import { buildTsHarness } from './harnessTs.js';
import { parseHarness, toRunResult } from './parse.js';
import type { StudentRunResult } from './types.js';

export async function runTsJs(
  code: string,
  entry: string,
  cases: CaseSpec[],
  language: 'typescript' | 'javascript',
  judge?: Judge,
): Promise<StudentRunResult> {
  const dir = await mkdtemp(join(tmpdir(), 'tutor-run-'));
  try {
    const runner = join(dir, 'runner.ts');
    await writeFile(runner, buildTsHarness(code, entry, cases, language, judge), 'utf8');
    const strip = process.env.TUTOR_TS_RUNNER === 'strip';
    const args = strip
      ? ['--no-warnings', '--experimental-strip-types', runner]
      : [join(SERVER_DIR, 'node_modules', 'tsx', 'dist', 'cli.mjs'), runner];
    const env = strip
      ? { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '' }
      : undefined;
    const { stdout, stderr, timedOut } = await runChild(process.execPath, args, {
      cwd: strip ? dir : SERVER_DIR,
      env,
      timeoutMs: TS_TIMEOUT_MS,
    });
    return toRunResult(cases, parseHarness(stdout, stderr, timedOut, TS_TIMEOUT_MS), judge);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
