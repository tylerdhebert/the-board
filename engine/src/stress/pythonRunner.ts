import { spawn } from 'node:child_process';
import { killTree } from '../llm.js';

export const ORACLE_TIMEOUT_MS = 5_000;
const KILL_GRACE_MS = 5_000;

export async function runPythonScript(
  script: string,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; code: number | null; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn('python', ['-'], {
      env: { ...process.env, PYTHONUTF8: '1' },
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
      setTimeout(() => settle(null), KILL_GRACE_MS).unref();
    }, timeoutMs);

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

    child.stdin.on('error', () => {});
    child.stdin.write(script, 'utf-8');
    child.stdin.end();
  });
}

export function lastJsonLine(stdout: string): string | undefined {
  return stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
}
