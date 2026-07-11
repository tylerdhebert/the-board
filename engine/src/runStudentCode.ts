import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CaseSpec } from './exampleCases.js';
import { killTree } from './llm.js';

export type RunCaseResult = {
  display: string;
  expected: string;
  got: string;
  pass: boolean;
  error?: string;
  /** True for tougher cases; official examples are false/omitted. */
  stress?: boolean;
};
export type StudentRunResult = { cases: RunCaseResult[]; error?: string };

type RunnableLang = 'python' | 'typescript' | 'javascript' | 'csharp';

type HarnessPayload =
  | { results: { got: unknown; error: string | null }[] }
  | { fatal: string };

const PYTHON_TIMEOUT_MS = 15_000;
const TS_TIMEOUT_MS = 20_000;
const CSHARP_TIMEOUT_MS = 60_000;
// After a timeout kill, how long to keep waiting for 'close' before settling
// anyway (a kill-race orphan can hold the stdio pipes open forever).
const KILL_GRACE_MS = 5_000;

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = join(__dirname, '..', '..', 'server');

/** Lazy so server can set TUTOR_RUN_SCRATCH_DIR before first use. */
function csharpScratch(): string {
  const runScratch = process.env.TUTOR_RUN_SCRATCH_DIR
    ? resolve(process.env.TUTOR_RUN_SCRATCH_DIR)
    : join(SERVER_DIR, '.run-scratch');
  return join(runScratch, 'csharp');
}

const CSPROJ = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net9.0</TargetFramework>
    <OutputType>Exe</OutputType>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>disable</Nullable>
  </PropertyGroup>
</Project>
`;

function detectEntryPoint(
  code: string,
  language: RunnableLang,
  scaffold?: string,
): string | null {
  const sources = [code, scaffold ?? ''];
  for (const src of sources) {
    if (!src) continue;
    if (language === 'python') {
      const method = src.match(/def (\w+)\(self/);
      if (method) return method[1]!;
      const top = src.match(/^def (\w+)\(/m);
      if (top) return top[1]!;
    } else if (language === 'typescript' || language === 'javascript') {
      const fn = src.match(/function (\w+)\s*\(/);
      if (fn) return fn[1]!;
      const arrow = src.match(/(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\(/);
      if (arrow) return arrow[1]!;
    } else if (language === 'csharp') {
      const m = src.match(/public\s+(?!class)[\w<>\[\],?\s]+?\s+(\w+)\s*\(/);
      if (m) return m[1]!;
    }
  }
  return null;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      // fall through to any-order check below only when lengths match after sort path
    } else if (a.every((v, i) => deepEqual(v, b[i]))) {
      return true;
    }
    // any-order leniency (mirrors verifyCard)
    try {
      const sa = [...a].map((x) => JSON.stringify(x)).sort();
      const sb = [...b].map((x) => JSON.stringify(x)).sort();
      return sa.length === sb.length && sa.every((v, i) => v === sb[i]);
    } catch {
      return false;
    }
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const ak = Object.keys(ao);
    const bk = Object.keys(bo);
    if (ak.length !== bk.length) return false;
    return ak.every((k) => deepEqual(ao[k], bo[k]));
  }
  return false;
}

function compareGot(got: unknown, expected: unknown): boolean {
  return deepEqual(got, expected);
}

async function runChild(
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

function lastJsonLine(stdout: string): string | undefined {
  return stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
}

function parseHarness(stdout: string, stderr: string, timedOut: boolean, timeoutMs: number): HarnessPayload {
  if (timedOut) {
    return { fatal: `timed out after ${timeoutMs / 1000}s (infinite loop?)` };
  }
  const line = lastJsonLine(stdout);
  if (!line) {
    const errLines = stderr.trim().split(/\r?\n/).filter(Boolean).slice(0, 10).join('\n');
    return { fatal: errLines || 'no harness output' };
  }
  try {
    return JSON.parse(line) as HarnessPayload;
  } catch {
    const errLines = stderr.trim().split(/\r?\n/).filter(Boolean).slice(0, 10).join('\n');
    return { fatal: errLines || `unparseable harness output: ${line.slice(0, 200)}` };
  }
}

function toRunResult(cases: CaseSpec[], payload: HarnessPayload): StudentRunResult {
  if ('fatal' in payload) {
    return { cases: [], error: payload.fatal };
  }
  const results = payload.results ?? [];
  const out: RunCaseResult[] = cases.map((c, i) => {
    const r = results[i];
    const expectedStr = JSON.stringify(c.expected);
    const stressMark = c.stress ? ({ stress: true } as const) : ({ stress: false } as const);
    if (!r) {
      return {
        display: c.display,
        expected: expectedStr,
        got: 'null',
        pass: false,
        error: 'missing result',
        ...stressMark,
      };
    }
    if (r.error != null) {
      return {
        display: c.display,
        expected: expectedStr,
        got: 'null',
        pass: false,
        error: r.error,
        ...stressMark,
      };
    }
    if ((r.got === null || r.got === undefined) && c.expected !== null) {
      return {
        display: c.display,
        expected: expectedStr,
        got: 'null',
        pass: false,
        error:
          "got nothing back — did you return the result? (in-place/mutation problems aren't supported yet)",
        ...stressMark,
      };
    }
    const pass = compareGot(r.got, c.expected);
    return {
      display: c.display,
      expected: expectedStr,
      got: JSON.stringify(r.got),
      pass,
      ...stressMark,
    };
  });
  return { cases: out };
}

function buildPythonHarness(code: string, entry: string, cases: CaseSpec[]): string {
  const codeJson = JSON.stringify(JSON.stringify(code));
  const casesJson = JSON.stringify(JSON.stringify(cases.map((c) => c.args)));
  const entryJson = JSON.stringify(entry);
  return `
import json, sys

code = json.loads(${codeJson})
cases = json.loads(${casesJson})
name = ${entryJson}

ns = {}
try:
    exec(code, ns)
except Exception as e:
    print(json.dumps({"fatal": f"load error: {e}"}))
    sys.exit(0)

if "Solution" in ns:
    try:
        entry = getattr(ns["Solution"](), name)
    except Exception as e:
        print(json.dumps({"fatal": f"could not bind Solution.{name}: {e}"}))
        sys.exit(0)
elif name in ns:
    entry = ns[name]
else:
    print(json.dumps({"fatal": f"could not find {name}"}))
    sys.exit(0)

results = []
for args in cases:
    try:
        got = entry(*args)
        results.append({"got": got, "error": None})
    except Exception as e:
        results.append({"got": None, "error": str(e)})

print(json.dumps({"results": results}))
`.trimStart();
}

function buildTsHarness(code: string, entry: string, cases: CaseSpec[], language: 'typescript' | 'javascript'): string {
  const casesJson = JSON.stringify(cases.map((c) => c.args));
  // Student code first; trailer calls the detected entry point.
  const trailer = `

;(() => {
  const __cases: unknown[][] = ${casesJson};
  const __fn: (...args: unknown[]) => unknown = ${entry} as any;
  const __results: { got: unknown; error: string | null }[] = [];
  for (const __args of __cases) {
    try {
      const __got = __fn(...__args);
      __results.push({ got: __got, error: null });
    } catch (__e) {
      __results.push({ got: null, error: __e instanceof Error ? __e.message : String(__e) });
    }
  }
  console.log(JSON.stringify({ results: __results }));
})();
`;
  // For JS, strip TypeScript-only annotations is not needed — tsx runs both.
  void language;
  return code + trailer;
}

function buildCsharpProgram(code: string, entry: string, casesPath: string): string {
  // Student code may already declare Solution; harness is a separate static class with Main.
  const casesPathLit = JSON.stringify(casesPath);
  return `${code}

static class __StudentHarness {
  static void Main() {
    try {
      var casesJson = System.IO.File.ReadAllText(${casesPathLit});
      using var casesDoc = System.Text.Json.JsonDocument.Parse(casesJson);
      var methodName = ${JSON.stringify(entry)};
      var solutionType = typeof(Solution);
      var method = solutionType.GetMethod(methodName,
        System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.IgnoreCase)
        ?? solutionType.GetMethod(methodName);
      if (method == null) {
        Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(new { fatal = $"could not find method {methodName}" }));
        return;
      }
      var instance = Activator.CreateInstance(solutionType);
      var parameters = method.GetParameters();
      var results = new System.Collections.Generic.List<object>();
      foreach (var caseEl in casesDoc.RootElement.EnumerateArray()) {
        try {
          var args = new object[parameters.Length];
          for (var i = 0; i < parameters.Length; i++) {
            var raw = caseEl[i];
            var pType = parameters[i].ParameterType;
            args[i] = System.Text.Json.JsonSerializer.Deserialize(raw.GetRawText(), pType);
          }
          var got = method.Invoke(instance, args);
          results.Add(new { got, error = (string)null });
        } catch (Exception e) {
          var msg = e is System.Reflection.TargetInvocationException tie && tie.InnerException != null
            ? tie.InnerException.Message
            : e.Message;
          results.Add(new { got = (object)null, error = msg });
        }
      }
      Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(new { results }));
    } catch (Exception e) {
      Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(new { fatal = e.Message }));
    }
  }
}
`;
}

async function ensureCsharpScratch(): Promise<void> {
  const scratch = csharpScratch();
  await mkdir(scratch, { recursive: true });
  await writeFile(join(scratch, 'run.csproj'), CSPROJ, 'utf8');
}

async function runPython(code: string, entry: string, cases: CaseSpec[]): Promise<StudentRunResult> {
  const script = buildPythonHarness(code, entry, cases);
  const { stdout, stderr, timedOut } = await runChild('python', ['-'], {
    env: { ...process.env, PYTHONUTF8: '1' },
    stdin: script,
    timeoutMs: PYTHON_TIMEOUT_MS,
  });
  return toRunResult(cases, parseHarness(stdout, stderr, timedOut, PYTHON_TIMEOUT_MS));
}

async function runTsJs(
  code: string,
  entry: string,
  cases: CaseSpec[],
  language: 'typescript' | 'javascript',
): Promise<StudentRunResult> {
  const dir = await mkdtemp(join(tmpdir(), 'tutor-run-'));
  try {
    const runner = join(dir, 'runner.ts');
    await writeFile(runner, buildTsHarness(code, entry, cases, language), 'utf8');
    // Prefer the local tsx CLI via node (avoids Windows npx.cmd spawn issues).
    const tsxCli = join(SERVER_DIR, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const { stdout, stderr, timedOut } = await runChild(process.execPath, [tsxCli, runner], {
      cwd: SERVER_DIR,
      timeoutMs: TS_TIMEOUT_MS,
    });
    return toRunResult(cases, parseHarness(stdout, stderr, timedOut, TS_TIMEOUT_MS));
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function runCsharp(code: string, entry: string, cases: CaseSpec[]): Promise<StudentRunResult> {
  await ensureCsharpScratch();
  const scratch = csharpScratch();
  const programPath = join(scratch, 'Program.cs');
  const casesPath = join(scratch, 'cases.json');
  await writeFile(casesPath, JSON.stringify(cases.map((c) => c.args)), 'utf8');
  await writeFile(programPath, buildCsharpProgram(code, entry, casesPath), 'utf8');

  const { stdout, stderr, timedOut, code: exitCode } = await runChild(
    'dotnet',
    ['run', '--project', scratch],
    { cwd: scratch, timeoutMs: CSHARP_TIMEOUT_MS },
  );

  if (timedOut) {
    return { cases: [], error: `timed out after ${CSHARP_TIMEOUT_MS / 1000}s (infinite loop?)` };
  }

  const line = lastJsonLine(stdout);
  if (line) {
    try {
      const payload = JSON.parse(line) as HarnessPayload;
      return toRunResult(cases, payload);
    } catch {
      // fall through to stderr fatal
    }
  }

  // Compile errors land on stderr
  if (exitCode !== 0 || !line) {
    const errLines = stderr.trim().split(/\r?\n/).filter(Boolean).slice(0, 10).join('\n');
    return { cases: [], error: errLines || `dotnet exited with code ${exitCode}` };
  }

  return toRunResult(cases, parseHarness(stdout, stderr, false, CSHARP_TIMEOUT_MS));
}

export async function runStudentCode(
  code: string,
  language: RunnableLang,
  cases: CaseSpec[],
  scaffold?: string,
): Promise<StudentRunResult> {
  const entry = detectEntryPoint(code, language, scaffold);
  if (!entry) {
    return { cases: [], error: 'could not find your function' };
  }

  try {
    if (language === 'python') return await runPython(code, entry, cases);
    if (language === 'typescript' || language === 'javascript') {
      return await runTsJs(code, entry, cases, language);
    }
    return await runCsharp(code, entry, cases);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { cases: [], error: message };
  }
}
