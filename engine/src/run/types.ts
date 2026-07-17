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
export type StudentRunResult = {
  cases: RunCaseResult[];
  error?: string;
  /** Student output captured before the harness result. This is never persisted. */
  console?: ConsoleBlock[];
};

export type ConsoleBlock = {
  /** The human-readable input for a case; omitted for module-load output. */
  label?: string;
  text: string;
};

export type RunnableLang = 'python' | 'typescript' | 'javascript' | 'csharp';

export type HarnessPayload =
  | { results: { got: unknown; error: string | null }[] }
  | { fatal: string };
