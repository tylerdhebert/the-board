import type { Judge } from '../types.js';
import { lastJsonLine, ORACLE_TIMEOUT_MS, runPythonScript } from './pythonRunner.js';

type OracleOk = { ok: true; output: string };
type OracleErr = { ok: false; error: string };
export type OracleResult = OracleOk | OracleErr;

function buildOracleScript(
  code: string,
  entrypoint: string,
  callSrc: string,
  judge?: Judge,
): string {
  const codeJson = JSON.stringify(JSON.stringify(code));
  const entryJson = JSON.stringify(entrypoint);
  const callJson = JSON.stringify(JSON.stringify(callSrc));
  const judgeJson = JSON.stringify(JSON.stringify(judge ?? null));
  return `
import ast, json, sys

code = json.loads(${codeJson})
entrypoint = ${entryJson}
call_src = json.loads(${callJson})
judge = json.loads(${judgeJson})

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
    ret = entry(*args)
except Exception as e:
    fail(f"raised: {e}")

if judge is None:
    got = ret
    try:
        out = repr(got)
        ast.literal_eval(out)
    except Exception as e:
        fail(f"output is not a Python literal: {e}")
elif judge["kind"] == "in-place":
    got = args[int(judge["argIndex"])]
    try:
        out = repr(got)
        ast.literal_eval(out)
    except Exception as e:
        fail(f"output is not a Python literal: {e}")
elif judge["kind"] == "k-prefix":
    idx = int(judge["argIndex"])
    k = ret
    arr = args[idx]
    if not isinstance(k, int) or k < 0 or k > len(arr):
        fail(f"k out of range: {k!r}")
    prefix = arr[:k]
    # Pad with _ past k so extractCases round-trips the official shape.
    padded = list(prefix) + ["_"] * (len(arr) - k)
    # Use a placeholder name; extractCases only needs "k, name = [...]".
    out = f"{k}, nums = [{', '.join('_' if x == '_' else repr(x) for x in padded)}]"
    got = {"k": k, "prefix": prefix}
else:
    fail(f"unknown judge kind: {judge!r}")

try:
    json.dumps(got)
except Exception as e:
    fail(f"output is not JSON-safe: {e}")

print(json.dumps({"ok": True, "output": out}))
`.trimStart();
}

export async function oracleOne(
  code: string,
  entrypoint: string,
  callSrc: string,
  judge?: Judge,
): Promise<OracleResult> {
  const script = buildOracleScript(code, entrypoint, callSrc, judge);
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
