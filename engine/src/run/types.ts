import type { Judge } from '../types.js';

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

export type RunnableLang = 'python' | 'typescript' | 'javascript' | 'csharp';

export type HarnessPayload =
  | { results: { got: unknown; error: string | null }[] }
  | { fatal: string };
