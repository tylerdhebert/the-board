import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { completeJson, killTree, type LLMClient } from './llm.js';
import { PROMPTS_DIR } from './paths.js';
import type { Example, ProblemCard } from './types.js';

const ORACLE_TIMEOUT_MS = 5_000;
const KILL_GRACE_MS = 5_000;
const MAX_STRESS = 6;

type OracleOk = { ok: true; output: string };
type OracleErr = { ok: false; error: string };
type OracleResult = OracleOk | OracleErr;

async function runPythonScript(
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

function lastJsonLine(stdout: string): string | undefined {
  return stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
}

/** Entrypoint name from the first official example call (AST). */
async function detectEntrypoint(examples: Example[]): Promise<string> {
  const first = examples[0]?.input?.trim();
  if (!first) {
    throw new Error('card has no official examples to derive the entrypoint from');
  }
  const script = `
import ast, json, sys
src = json.loads(${JSON.stringify(JSON.stringify(first))})
try:
    tree = ast.parse(src, mode="eval")
except SyntaxError as e:
    print(json.dumps({"error": f"bad example input: {e}"}))
    sys.exit(0)
if not isinstance(tree.body, ast.Call):
    print(json.dumps({"error": "example input is not a call"}))
    sys.exit(0)
func = tree.body.func
if isinstance(func, ast.Name):
    print(json.dumps({"name": func.id}))
else:
    print(json.dumps({"error": "example call is not a bare function name"}))
`.trimStart();

  const { stdout, stderr, code, timedOut } = await runPythonScript(script, 10_000);
  if (timedOut) throw new Error('entrypoint detection timed out');
  if (code !== 0) throw new Error(stderr.trim() || `python exited with code ${code}`);
  const line = lastJsonLine(stdout);
  if (!line) throw new Error(stderr.trim() || 'entrypoint detection: empty stdout');
  const parsed = JSON.parse(line) as { name?: string; error?: string };
  if (parsed.error) throw new Error(parsed.error);
  if (!parsed.name) throw new Error('entrypoint detection failed');
  return parsed.name;
}

function buildOracleScript(code: string, entrypoint: string, callSrc: string): string {
  const codeJson = JSON.stringify(JSON.stringify(code));
  const entryJson = JSON.stringify(entrypoint);
  const callJson = JSON.stringify(JSON.stringify(callSrc));
  return `
import ast, json, sys

code = json.loads(${codeJson})
entrypoint = ${entryJson}
call_src = json.loads(${callJson})

def fail(msg):
    print(json.dumps({"ok": False, "error": msg}))
    sys.exit(0)

try:
    tree = ast.parse(call_src, mode="eval")
except SyntaxError as e:
    fail(f"bad call syntax: {e}")

if not isinstance(tree.body, ast.Call):
    fail("not a call expression")

call = tree.body
if not isinstance(call.func, ast.Name):
    fail("call must use a bare function name")
if call.func.id != entrypoint:
    fail(f"entrypoint mismatch: expected {entrypoint}, got {call.func.id}")
if call.keywords:
    fail("keyword arguments are not supported")

try:
    args = [ast.literal_eval(a) for a in call.args]
except Exception as e:
    fail(f"non-literal arguments: {e}")

ns = {}
try:
    exec(code, ns)
except Exception as e:
    fail(f"reference load error: {e}")

if "Solution" in ns:
    try:
        entry = getattr(ns["Solution"](), entrypoint)
    except Exception as e:
        fail(f"could not bind Solution.{entrypoint}: {e}")
elif entrypoint in ns:
    entry = ns[entrypoint]
else:
    fail(f"could not find {entrypoint}")

try:
    got = entry(*args)
except Exception as e:
    fail(f"raised: {e}")

try:
    out = repr(got)
    ast.literal_eval(out)
except Exception as e:
    fail(f"output is not a Python literal: {e}")

try:
    json.dumps(got)
except Exception as e:
    fail(f"output is not JSON-safe: {e}")

print(json.dumps({"ok": True, "output": out}))
`.trimStart();
}

async function oracleOne(
  code: string,
  entrypoint: string,
  callSrc: string,
): Promise<OracleResult> {
  const script = buildOracleScript(code, entrypoint, callSrc);
  try {
    const { stdout, stderr, code: exitCode, timedOut } = await runPythonScript(
      script,
      ORACLE_TIMEOUT_MS,
    );
    if (timedOut) {
      return { ok: false, error: `timed out after ${ORACLE_TIMEOUT_MS / 1000}s` };
    }
    if (exitCode !== 0) {
      return { ok: false, error: stderr.trim() || `python exited with code ${exitCode}` };
    }
    const line = lastJsonLine(stdout);
    if (!line) {
      return { ok: false, error: stderr.trim() || 'empty oracle stdout' };
    }
    const parsed = JSON.parse(line) as OracleResult;
    if (!parsed || typeof parsed !== 'object' || !('ok' in parsed)) {
      return { ok: false, error: 'unparseable oracle result' };
    }
    return parsed;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

function parseInputsPayload(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((x): x is string => typeof x === 'string');
  }
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const inputs = obj.inputs ?? obj.cases ?? obj.calls;
    if (Array.isArray(inputs)) {
      return inputs.filter((x): x is string => typeof x === 'string');
    }
  }
  throw new Error('stress generation returned unexpected JSON shape (expected {"inputs":[...]})');
}

/**
 * LLM proposes adversarial input calls only; expected outputs come from
 * executing the card's verified Python reference (one short-timeout child each).
 */
export async function generateStressCases(
  client: LLMClient,
  card: ProblemCard,
  model: string,
): Promise<Example[]> {
  if (!card.optimal.language.toLowerCase().includes('python')) {
    throw new Error(
      `stress cases require a Python reference (got "${card.optimal.language}")`,
    );
  }
  if (!card.examples?.length) {
    throw new Error('card has no official examples');
  }

  const entrypoint = await detectEntrypoint(card.examples);
  const basePrompt = await readFile(join(PROMPTS_DIR, 'stress_prompt.md'), 'utf-8');
  const officialInputs = card.examples.map((e) => e.input.trim());
  const prompt =
    basePrompt +
    `\n\n## TITLE\n${card.title}` +
    `\n\n## STATEMENT\n${card.statement}` +
    `\n\n## CONSTRAINTS\n${card.constraints}` +
    `\n\n## ENTRYPOINT\n${entrypoint}` +
    `\n\n## OFFICIAL EXAMPLE INPUTS\n` +
    officialInputs.map((s) => `- ${s}`).join('\n');

  const raw = await completeJson<unknown>(client, {
    model,
    prompt,
    label: 'stress',
  });

  let proposals = parseInputsPayload(raw)
    .map((s) => s.trim())
    .filter(Boolean);
  if (proposals.length === 0) {
    throw new Error('stress generation returned no input strings');
  }
  proposals = proposals.slice(0, MAX_STRESS);

  const officialSet = new Set(officialInputs);
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const p of proposals) {
    if (officialSet.has(p) || seen.has(p)) continue;
    seen.add(p);
    unique.push(p);
  }

  const rows: Example[] = [];
  for (const input of unique) {
    const result = await oracleOne(card.optimal.code, entrypoint, input);
    if (!result.ok) continue;
    rows.push({ input, output: result.output });
  }

  if (rows.length === 0) {
    throw new Error(
      'no valid tougher cases survived validation/oracle (all proposals were dropped)',
    );
  }
  return rows;
}
