export interface BruteForce { approach: string; time: string; space: string }
export interface Optimal { approach: string; language: string; code: string; time: string; space: string }
export interface Trap { wrong_approach: string; why_wrong: string; counterexample: string }
export interface Example { input: string; output: string }
/** How to extract "got" after calling the solution (absent = return-value grading). */
export type Judge =
  | { kind: 'in-place'; argIndex: number }
  | { kind: 'k-prefix'; argIndex: number };
export interface ProblemCard {
  title: string;
  statement: string;
  constraints: string;
  difficulty?: string;
  brute_force: BruteForce;
  optimal: Optimal;
  key_insight: string;
  ladder: string[];
  traps: Trap[];
  leak_terms: string[];
  underlying_primitive: string;
  examples: Example[];
  /** Cached tougher cases; oracle outputs from the verified Python reference. */
  stress?: Example[];
  /** Detected at ingest from LeetCode metaData; never produced by the card LLM. */
  judge?: Judge;
  /** Canonical LeetCode problem URL, for the submit link. Set at ingest. */
  url?: string;
  /** Statement figures downloaded at ingest; statement refers to them as ![alt](figure:N). */
  figures?: { alt: string; data: string }[];
}
export type TutorMode = 'socratic' | 'analog' | 'scaffold';
export type GateOffense = 'leak' | 'wrong-endorsement' | 'premature-bridge' | 'premature-answer' | 'none';
export interface GateVerdict { verdict: 'PASS' | 'REVISE'; offense: GateOffense; note: string }
export interface Message { role: 'student' | 'teacher'; content: string }
