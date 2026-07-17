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
  /** Working directory for CLI backends (teacher scratch). */
  cwd?: string;
  /** Override the no-output watchdog for this individual CLI call. */
  inactivityMs?: number;
  /** Cancel the CLI process tree when the caller no longer needs this work. */
  signal?: AbortSignal;
}
export interface LLMClient { complete(req: LLMRequest): Promise<string> }

/** A caller-initiated cancellation, distinct from a failed or stalled CLI call. */
export class LlmCanceledError extends Error {
  readonly code = 'LLM_CANCELED';

  constructor() {
    super('LLM request canceled');
    this.name = 'LlmCanceledError';
  }
}

export function isLlmCanceledError(err: unknown): err is LlmCanceledError {
  return err instanceof LlmCanceledError ||
    (err instanceof Error && (err as Error & { code?: string }).code === 'LLM_CANCELED');
}

// A CLI stream can stall silently and never exit (observed 2026-07-09: codex
// emitted one reasoning chunk then went quiet forever, hanging /api/start).
// Watchdog: if the child produces no output at all for this long, kill its
// whole process tree and fail the call so the caller can surface an error.
const CLI_INACTIVITY_MS = Number(process.env.TUTOR_CLI_INACTIVITY_MS ?? 120_000);
// After a timeout kill, how long to keep waiting for 'close' before settling
// anyway (a kill-race orphan can hold the stdio pipes open forever).
const KILL_GRACE_MS = 5_000;

export function killTree(pid: number): Promise<boolean> {
  if (process.platform === 'win32') {
    // codex is a 3-deep chain (shim -> node -> codex.exe + its repl runtime);
    // child.kill() would only take out the shim and orphan the rest.
    return new Promise((resolve) => {
      const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F']);
      killer.once('error', () => resolve(false));
      killer.once('close', (code) => resolve(code === 0));
    });
  } else {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
    }
    return Promise.resolve(true);
  }
}

export function runCli(
  command: string,
  args: string[],
  stdin: string,
  env: NodeJS.ProcessEnv,
  opts?: { cwd?: string; inactivityMs?: number; signal?: AbortSignal },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    if (opts?.signal?.aborted) {
      reject(new LlmCanceledError());
      return;
    }
    const child = spawn(command, args, { env, cwd: opts?.cwd });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;
    let aborted = false;
    let settled = false;
    let watchdog: NodeJS.Timeout | undefined;
    const inactivityMs = opts?.inactivityMs ?? CLI_INACTIVITY_MS;
    const onAbort = () => {
      if (settled) return;
      aborted = true;
      if (child.pid == null) {
        fail(new LlmCanceledError());
      } else {
        void killTree(child.pid).then((treeKilled) => {
          if (!treeKilled) child.kill();
        }).finally(() => {
          setTimeout(() => fail(new LlmCanceledError()), KILL_GRACE_MS).unref();
        });
      }
    };
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      opts?.signal?.removeEventListener('abort', onAbort);
      reject(err);
    };
    const resetWatchdog = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        timedOut = true;
        if (child.pid != null) {
          void killTree(child.pid).then((treeKilled) => {
            if (!treeKilled) child.kill();
          });
        }
        // 'close' waits for the stdio pipes, and a kill-race survivor (an orphaned
        // grandchild holding the inherited handles) can keep them open forever —
        // after the kill, stop waiting for it.
        setTimeout(() => fail(new Error(
          `${command} produced no output for ${inactivityMs / 1000}s and was killed ` +
          '(stalled stream?) — try again',
        )), KILL_GRACE_MS).unref();
      }, inactivityMs);
    };
    resetWatchdog();
    opts?.signal?.addEventListener('abort', onAbort, { once: true });

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
      fail(err instanceof Error ? err : new Error(String(err)));
    });

    child.on('close', (code) => {
      if (settled) return;
      clearTimeout(watchdog);
      if (aborted) {
        fail(new LlmCanceledError());
        return;
      }
      const stdout = Buffer.concat(stdoutChunks).toString('utf-8');
      const stderr = Buffer.concat(stderrChunks).toString('utf-8');
      if (timedOut) {
        fail(new Error(
          `${command} produced no output for ${inactivityMs / 1000}s and was killed ` +
          '(stalled stream?) — try again',
        ));
      } else if (code === 0) {
        settled = true;
        opts?.signal?.removeEventListener('abort', onAbort);
        resolve({ stdout, stderr });
      } else {
        fail(new Error(`${command} exited with code ${code}: ${stderr}`));
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
      await runCli(
        'codex',
        args,
        req.prompt,
        { ...process.env, PYTHONUTF8: '1' },
        { cwd: req.cwd, inactivityMs: req.inactivityMs, signal: req.signal },
      );
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
    const { stdout } = await runCli(
      'claude',
      args,
      req.prompt,
      { ...process.env },
      { cwd: req.cwd, inactivityMs: req.inactivityMs, signal: req.signal },
    );
    return stdout.trim();
  }
}

/** Some CLIs (claude) wrap JSON answers in markdown fences — unwrap before parsing. */
function stripMarkdownFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/.exec(trimmed);
  return fenced ? fenced[1]!.trim() : trimmed;
}

export async function completeJson<T>(client: LLMClient, req: LLMRequest): Promise<T> {
  const raw = await client.complete(req);
  const cleaned = stripMarkdownFences(raw);
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new Error(`Failed to parse JSON from LLM output: ${raw.slice(0, 400)}`);
  }
}
