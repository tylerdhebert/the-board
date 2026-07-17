import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { isLlmCanceledError, runCli } from '../src/llm.js';

const pidFile = join(tmpdir(), `tutor-abort-${randomUUID()}.pid`);
const controller = new AbortController();
const sleeper = "import os, pathlib, sys, time; pathlib.Path(sys.argv[1]).write_text(str(os.getpid())); time.sleep(60)";

function childIsAlive(pid: number): boolean {
  if (process.platform === 'win32') {
    return spawnSync('powershell', [
      '-NoProfile', '-NonInteractive', '-Command',
      `if (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }`,
    ]).status === 0;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

try {
  const pending = runCli('python', ['-c', sleeper, pidFile], '', process.env, {
    signal: controller.signal,
    inactivityMs: 120_000,
  });
  const startedAt = Date.now();
  while (!existsSync(pidFile)) {
    if (Date.now() - startedAt > 5_000) throw new Error('python did not write its pid');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const pid = Number(await readFile(pidFile, 'utf8'));
  setTimeout(() => controller.abort(), 2_000);
  await pending.then(
    () => { throw new Error('runCli resolved after abort'); },
    (err: unknown) => {
      if (!isLlmCanceledError(err)) throw err;
    },
  );
  const deadline = Date.now() + 5_000;
  while (childIsAlive(pid)) {
    if (Date.now() >= deadline) throw new Error(`child ${pid} is still alive after cancellation`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  console.log('abort verified: cancellation error and dead child')
} finally {
  await rm(pidFile, { force: true });
}
