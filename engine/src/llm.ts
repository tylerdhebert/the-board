import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface LLMRequest {
  model: string;
  prompt: string;
  outputSchemaPath?: string;
  /** e.g. 'teacher' | 'gate' | 'unlock' — used only for tracing. */
  label?: string;
}
export interface LLMClient { complete(req: LLMRequest): Promise<string> }

// A CLI stream can stall silently and never exit (observed 2026-07-09: codex
// emitted one reasoning chunk then went quiet forever, hanging /api/start).
// Watchdog: if the child produces no output at all for this long, kill its
// whole process tree and fail the call so the caller can surface an error.
const CLI_INACTIVITY_MS = Number(process.env.TUTOR_CLI_INACTIVITY_MS ?? 120_000);

export function killTree(pid: number): void {
  if (process.platform === 'win32') {
    // codex is a 3-deep chain (shim -> node -> codex.exe + its repl runtime);
    // child.kill() would only take out the shim and orphan the rest.
    spawn('taskkill', ['/PID', String(pid), '/T', '/F']).on('error', () => {});
  } else {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
    }
  }
}

function runCli(
  command: string,
  args: string[],
  stdin: string,
  env: NodeJS.ProcessEnv,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;
    let watchdog: NodeJS.Timeout | undefined;
    const resetWatchdog = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        timedOut = true;
        if (child.pid != null) killTree(child.pid);
      }, CLI_INACTIVITY_MS);
    };
    resetWatchdog();

    // Drain stdout even when the answer arrives elsewhere (codex -o file):
    // an unread pipe fills at ~64KB and deadlocks the child. Any output also
    // counts as liveness for the watchdog.
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      resetWatchdog();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
      resetWatchdog();
    });

    child.on('error', (err) => {
      clearTimeout(watchdog);
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(watchdog);
      const stdout = Buffer.concat(stdoutChunks).toString('utf-8');
      const stderr = Buffer.concat(stderrChunks).toString('utf-8');
      if (timedOut) {
        reject(new Error(
          `${command} produced no output for ${CLI_INACTIVITY_MS / 1000}s and was killed ` +
          '(stalled stream?) — try again',
        ));
      } else if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`${command} exited with code ${code}: ${stderr}`));
      }
    });

    child.stdin.on('error', () => {}); // child may die before stdin flushes
    child.stdin.write(stdin, 'utf-8');
    child.stdin.end();
  });
}

export class CodexCliClient implements LLMClient {
  async complete(req: LLMRequest): Promise<string> {
    const tempfile = join(tmpdir(), `codex-out-${randomBytes(16).toString('hex')}.txt`);
    const args = [
      '--ask-for-approval', 'never',
      'exec',
      '-m', req.model,
      '--skip-git-repo-check',
      '-s', 'read-only',
    ];
    if (req.outputSchemaPath) {
      args.push('--output-schema', req.outputSchemaPath);
    }
    args.push('-o', tempfile, '-');

    try {
      await runCli('codex', args, req.prompt, { ...process.env, PYTHONUTF8: '1' });
      const output = await readFile(tempfile, 'utf-8');
      return output.trim();
    } finally {
      try {
        await unlink(tempfile);
      } catch {
        // tempfile may not exist if spawn failed early
      }
    }
  }
}

export class ClaudeCliClient implements LLMClient {
  async complete(req: LLMRequest): Promise<string> {
    const args = ['-p', '--output-format', 'text'];
    if (req.model) {
      args.push('--model', req.model);
    }
    // req.outputSchemaPath is ignored — claude text mode has no schema.
    const { stdout } = await runCli('claude', args, req.prompt, { ...process.env });
    return stdout.trim();
  }
}

export async function completeJson<T>(client: LLMClient, req: LLMRequest): Promise<T> {
  const raw = await client.complete(req);
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`Failed to parse JSON from LLM output: ${raw.slice(0, 400)}`);
  }
}
