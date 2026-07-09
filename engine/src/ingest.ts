import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { completeJson, type LLMClient } from './llm.js';
import { PROMPTS_DIR, SCHEMA_PATH } from './paths.js';
import type { ProblemCard } from './types.js';

export interface VerificationResult {
  ok: boolean;
  cases: { input: string; expected: string; got: string; pass: boolean }[];
  error?: string; // set if the reference code failed to run at all
}
export interface IngestResult { card: ProblemCard; verification: VerificationResult }

export async function generateCard(
  client: LLMClient,
  statement: string,
  model: string,
): Promise<ProblemCard> {
  const ingestPrompt = await readFile(join(PROMPTS_DIR, 'ingest_prompt.md'), 'utf-8');
  const prompt = ingestPrompt + '\n\n## PROBLEM STATEMENT\n' + statement;
  return await completeJson<ProblemCard>(client, {
    model,
    prompt,
    outputSchemaPath: SCHEMA_PATH,
  });
}

function buildVerifyScript(card: ProblemCard): string {
  // Embed JSON literals safely; Python json.loads them (do not concat raw code).
  // Double-stringify so the Python source contains a string whose contents are JSON
  // (a single stringify would embed a bare object/array literal, or let Python
  // reinterpret escape sequences inside a JSON string).
  const codeJson = JSON.stringify(JSON.stringify(card.optimal.code));
  const examplesJson = JSON.stringify(JSON.stringify(card.examples));
  return `
import ast, json, sys

code = json.loads(${codeJson})
examples = json.loads(${examplesJson})

ns = {}
try:
    exec(code, ns)
except Exception as e:
    print(json.dumps({"cases": [], "error": str(e)}))
    sys.exit(0)

cases = []
for ex in examples:
    inp = ex["input"]
    out = ex["output"]
    got = eval(inp, ns)
    expected = ast.literal_eval(out)
    if got == expected or (isinstance(got, list) and isinstance(expected, list) and sorted(got) == sorted(expected)):
        passed = True
    else:
        passed = False
    cases.append({
        "input": inp,
        "expected": out,
        "got": json.dumps(got),
        "pass": passed,
    })

print(json.dumps({"cases": cases, "error": None}))
`.trimStart();
}

export async function verifyCard(card: ProblemCard): Promise<VerificationResult> {
  if (!card.optimal.language.toLowerCase().includes('python')) {
    return {
      ok: false,
      cases: [],
      error: `unsupported language: ${card.optimal.language}`,
    };
  }

  const script = buildVerifyScript(card);

  const { stdout, stderr, code } = await new Promise<{
    stdout: string;
    stderr: string;
    code: number | null;
  }>((resolve, reject) => {
    const child = spawn('python', ['-'], {
      env: { ...process.env, PYTHONUTF8: '1' },
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });
    child.on('error', reject);
    child.on('close', (exitCode) => {
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: Buffer.concat(stderrChunks).toString('utf-8'),
        code: exitCode,
      });
    });

    child.stdin.write(script, 'utf-8');
    child.stdin.end();
  });

  if (code !== 0) {
    return {
      ok: false,
      cases: [],
      error: stderr.trim() || `python exited with code ${code}`,
    };
  }

  const line = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
  if (!line) {
    return {
      ok: false,
      cases: [],
      error: stderr.trim() || 'unparseable output: empty stdout',
    };
  }

  let parsed: { cases: VerificationResult['cases']; error: string | null };
  try {
    parsed = JSON.parse(line) as { cases: VerificationResult['cases']; error: string | null };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      cases: [],
      error: stderr.trim() || `unparseable output: ${message}`,
    };
  }

  const cases = parsed.cases ?? [];
  const error = parsed.error ?? undefined;
  // A card with zero cases is UNVERIFIABLE, not verified — reject vacuous truth.
  const ok = error == null && cases.length > 0 && cases.every((c) => c.pass);
  return error != null ? { ok, cases, error } : { ok, cases };
}

export async function ingest(
  client: LLMClient,
  statement: string,
  model: string,
): Promise<IngestResult> {
  const card = await generateCard(client, statement, model);
  const verification = await verifyCard(card);
  return { card, verification };
}
