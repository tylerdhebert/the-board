import type { Example } from '../types.js';
import { lastJsonLine, runPythonScript } from './pythonRunner.js';

/** Entrypoint name from the first official example call (AST). */
export async function detectEntrypoint(examples: Example[]): Promise<string> {
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
