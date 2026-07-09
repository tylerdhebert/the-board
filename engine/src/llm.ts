import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface LLMRequest { model: string; prompt: string; outputSchemaPath?: string }
export interface LLMClient { complete(req: LLMRequest): Promise<string> }

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

    const stderrChunks: Buffer[] = [];

    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn('codex', args, {
          env: { ...process.env, PYTHONUTF8: '1' },
        });

        child.stderr.on('data', (chunk: Buffer) => {
          stderrChunks.push(chunk);
        });

        child.on('error', reject);

        child.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            const stderr = Buffer.concat(stderrChunks).toString('utf-8');
            reject(new Error(`codex exited with code ${code}: ${stderr}`));
          }
        });

        child.stdin.write(req.prompt, 'utf-8');
        child.stdin.end();
      });

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

export async function completeJson<T>(client: LLMClient, req: LLMRequest): Promise<T> {
  const raw = await client.complete(req);
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`Failed to parse JSON from LLM output: ${raw.slice(0, 400)}`);
  }
}
