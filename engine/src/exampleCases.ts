import { spawn } from 'node:child_process';
import { killTree } from './llm.js';
import type { Judge } from './types.js';

export type CaseSpec = {
  display: string;
  args: unknown[];
  expected: unknown;
  /** True for cached tougher cases; official examples are false/omitted. */
  stress?: boolean;
};

const EXTRACT_TIMEOUT_MS = 10_000;
// After a timeout kill, how long to keep waiting for 'close' before settling
// anyway (a kill-race orphan can hold the stdio pipes open forever).
const KILL_GRACE_MS = 5_000;

function buildExtractScript(
  examples: { input: string; output: string }[],
  judge?: Judge,
): string {
  const examplesJson = JSON.stringify(JSON.stringify(examples));
  const judgeJson = JSON.stringify(JSON.stringify(judge ?? null));
  return `
import ast, json, sys, re

examples = json.loads(${examplesJson})
judge = json.loads(${judgeJson})

def parse_k_prefix(out):
    m = re.match(r"^\\s*(\\d+)\\s*,\\s*\\w+\\s*=\\s*(\\[.*)\\s*$", out, re.DOTALL)
    if not m:
        raise ValueError(f"not a k-prefix output: {out!r}")
    k = int(m.group(1))
    raw_list = ast.literal_eval(m.group(2).replace("_", "None"))
    prefix = [x for x in raw_list if x is not None]
    return {"k": k, "prefix": prefix}

out = []
for ex in examples:
    inp = ex["input"]
    try:
        tree = ast.parse(inp, mode="eval")
    except SyntaxError as e:
        print(json.dumps({"error": f"bad example input {inp!r}: {e}"}))
        sys.exit(0)
    if not isinstance(tree.body, ast.Call):
        print(json.dumps({"error": f"example input is not a call: {inp!r}"}))
        sys.exit(0)
    try:
        args = [ast.literal_eval(a) for a in tree.body.args]
        if judge is not None and judge.get("kind") == "k-prefix":
            expected = parse_k_prefix(ex["output"])
        else:
            expected = ast.literal_eval(ex["output"])
    except Exception as e:
        print(json.dumps({"error": f"failed to eval example {inp!r}: {e}"}))
        sys.exit(0)
    out.append({"args": args, "expected": expected})
print(json.dumps(out))
`.trimStart();
}

export async function extractCases(
  examples: { input: string; output: string }[],
  opts?: { stress?: boolean; judge?: Judge },
): Promise<CaseSpec[]> {
  const script = buildExtractScript(examples, opts?.judge);

  const { stdout, stderr, code, timedOut } = await new Promise<{
    stdout: string;
    stderr: string;
    code: number | null;
    timedOut: boolean;
  }>((resolve, reject) => {
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
      // 'close' waits for the stdio pipes, and a kill-race survivor (an orphaned
      // grandchild holding the inherited handles) can keep them open forever —
      // after the kill, stop waiting for it.
      setTimeout(() => settle(null), KILL_GRACE_MS).unref();
    }, EXTRACT_TIMEOUT_MS);

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

  if (timedOut) {
    throw new Error(`extractCases timed out after ${EXTRACT_TIMEOUT_MS / 1000}s`);
  }
  if (code !== 0) {
    throw new Error(stderr.trim() || `python exited with code ${code}`);
  }

  const line = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
  if (!line) {
    throw new Error(stderr.trim() || 'extractCases: empty stdout');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(line) as unknown;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`extractCases: unparseable output: ${message}`);
  }

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'error' in parsed) {
    throw new Error(String((parsed as { error: unknown }).error));
  }
  if (!Array.isArray(parsed)) {
    throw new Error('extractCases: expected a JSON array');
  }

  const stress = opts?.stress === true;
  return parsed.map((row, i) => {
    const r = row as { args: unknown[]; expected: unknown };
    const display = examples[i]?.input ?? `case ${i}`;
    return {
      display,
      args: r.args,
      expected: r.expected,
      ...(stress ? { stress: true } : { stress: false }),
    };
  });
}
