import type { CaseSpec } from '../exampleCases.js';
import type { Judge } from '../types.js';

export function buildPythonHarness(code: string, entry: string, cases: CaseSpec[], judge?: Judge): string {
  const codeJson = JSON.stringify(JSON.stringify(code));
  const casesJson = JSON.stringify(JSON.stringify(cases.map((c) => c.args)));
  const entryJson = JSON.stringify(entry);
  const judgeJson = JSON.stringify(JSON.stringify(judge ?? null));
  return `
import json, sys

code = json.loads(${codeJson})
cases = json.loads(${casesJson})
name = ${entryJson}
judge = json.loads(${judgeJson})

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
        ret = entry(*args)
        if judge is None:
            got = ret
        elif judge["kind"] == "in-place":
            got = args[int(judge["argIndex"])]
        elif judge["kind"] == "k-prefix":
            idx = int(judge["argIndex"])
            k = ret
            arr = args[idx]
            if not isinstance(k, int) or k < 0 or k > len(arr):
                results.append({"got": None, "error": f"k out of range: {k!r}"})
                continue
            got = {"k": k, "prefix": arr[:k]}
        else:
            results.append({"got": None, "error": f"unknown judge kind: {judge!r}"})
            continue
        results.append({"got": got, "error": None})
    except Exception as e:
        results.append({"got": None, "error": str(e)})

print(json.dumps({"results": results}))
`.trimStart();
}
