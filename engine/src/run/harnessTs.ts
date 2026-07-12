import type { CaseSpec } from '../exampleCases.js';
import type { Judge } from '../types.js';

export function buildTsHarness(
  code: string,
  entry: string,
  cases: CaseSpec[],
  language: 'typescript' | 'javascript',
  judge?: Judge,
): string {
  const casesJson = JSON.stringify(cases.map((c) => c.args));
  const judgeJson = JSON.stringify(judge ?? null);
  // Student code first; trailer calls the detected entry point.
  const trailer = `

;(() => {
  const __cases: unknown[][] = ${casesJson};
  const __judge: { kind: string; argIndex: number } | null = ${judgeJson};
  const __fn: (...args: unknown[]) => unknown = ${entry} as any;
  const __results: { got: unknown; error: string | null }[] = [];
  for (const __args of __cases) {
    try {
      const __ret = __fn(...__args);
      let __got: unknown = __ret;
      if (__judge != null) {
        if (__judge.kind === 'in-place') {
          __got = __args[__judge.argIndex];
        } else if (__judge.kind === 'k-prefix') {
          const __arr = __args[__judge.argIndex] as unknown[];
          const __k = __ret as number;
          if (typeof __k !== 'number' || __k < 0 || __k > __arr.length) {
            __results.push({ got: null, error: \`k out of range: \${JSON.stringify(__k)}\` });
            continue;
          }
          __got = { k: __k, prefix: __arr.slice(0, __k) };
        }
      }
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
