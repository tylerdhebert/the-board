export interface BruteForce { approach: string; time: string; space: string }
export interface Optimal { approach: string; language: string; code: string; time: string; space: string }
export interface Trap { wrong_approach: string; why_wrong: string; counterexample: string }
export interface Example { input: string; output: string }
export interface ProblemCard {
  title: string;
  statement: string;
  constraints: string;
  brute_force: BruteForce;
  optimal: Optimal;
  key_insight: string;
  ladder: string[];
  traps: Trap[];
  leak_terms: string[];
  underlying_primitive: string;
  examples: Example[];
}
export type TutorMode = 'socratic' | 'analog' | 'scaffold';
export type GateOffense = 'leak' | 'wrong-endorsement' | 'premature-bridge' | 'premature-answer' | 'none';
export interface GateVerdict { verdict: 'PASS' | 'REVISE'; offense: GateOffense; note: string }
export interface Message { role: 'student' | 'teacher'; content: string }
