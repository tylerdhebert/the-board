import { spawn } from 'node:child_process';
import { killTree } from '../llm.js';
import { KILL_GRACE_MS } from './constants.js';

export async function runChild(
  command: string,
  args: string[],
  opts: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    stdin?: string;
    timeoutMs: number;
  },
): Promise<{ stdout: string; stderr: string; code: number | null; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let killed = false;
    let settled = false;
    const settle = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: Buffer.concat(stderrChunks).toString('utf-8'),
        code: exitCode,
        timedOut: killed,
      });
    };
    const timer = setTimeout(() => {
      killed = true;
      if (child.pid != null) killTree(child.pid);
      else child.kill();
      // 'close' waits for the stdio pipes, and a kill-race survivor (an orphaned
      // grandchild holding the inherited handles) can keep them open forever —
      // after the kill, stop waiting for it.
      setTimeout(() => settle(null), KILL_GRACE_MS).unref();
    }, opts.timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (exitCode) => {
      settle(exitCode);
    });

    if (opts.stdin != null) {
      child.stdin.on('error', () => {});
      child.stdin.write(opts.stdin, 'utf-8');
      child.stdin.end();
    }
  });
}

export function lastJsonLine(stdout: string): string | undefined {
  return stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
}
