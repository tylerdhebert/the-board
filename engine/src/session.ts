import { gateCheck } from './gate.js';
import type { LLMClient } from './llm.js';
import { createClient } from './providers.js';
import { teacherTurn } from './teacher.js';
import { NullTracer, TracingLLMClient, type Tracer } from './trace.js';
import type { GateVerdict, Message, ProblemCard, TutorMode } from './types.js';
import { judgeUnlock } from './unlockJudge.js';

export interface RoleConfig { backend: string; model: string }
export interface SessionModels { teacher: RoleConfig; gate: RoleConfig; unlock: RoleConfig }

export type TurnStage = 'unlock' | 'draft' | 'gate' | 'redraft';

export interface TurnResult {
  mode: TutorMode;
  reply: string;
  gate: GateVerdict;
  redrafted: boolean;
  unlockedThisTurn: string[];
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4);
}

export function shouldJudgeUnlock(studentMessage: string, lockedTerms: string[]): boolean {
  const studentWords = new Set(tokenize(studentMessage));
  for (const term of lockedTerms) {
    for (const word of tokenize(term)) {
      if (studentWords.has(word)) return true;
    }
  }
  return false;
}

export class TutorSession {
  private readonly card: ProblemCard;
  private readonly teacherClient: LLMClient;
  private readonly gateClient: LLMClient;
  private readonly unlockClient: LLMClient;
  private readonly models: SessionModels;
  private readonly tracer: Tracer;
  private readonly _transcript: Message[] = [];
  private readonly _lockedTerms: string[];
  private turnCounter = 0;

  constructor(
    card: ProblemCard,
    models: SessionModels,
    opts?: {
      tracer?: Tracer;
      createClient?: (backend: string) => LLMClient;
      restore?: { transcript: Message[]; lockedTerms: string[]; turnCounter: number };
    },
  ) {
    const resolve = opts?.createClient ?? createClient;
    const tracer = opts?.tracer ?? new NullTracer();
    this.teacherClient = new TracingLLMClient(resolve(models.teacher.backend), tracer, models.teacher.backend);
    this.gateClient = new TracingLLMClient(resolve(models.gate.backend), tracer, models.gate.backend);
    this.unlockClient = new TracingLLMClient(resolve(models.unlock.backend), tracer, models.unlock.backend);
    this.card = card;
    this.models = models;
    this.tracer = tracer;
    if (opts?.restore) {
      this._transcript.push(...opts.restore.transcript.map((m) => ({ ...m })));
      this._lockedTerms = [...opts.restore.lockedTerms];
      this.turnCounter = opts.restore.turnCounter;
    } else {
      this._lockedTerms = [...card.leak_terms];
    }
  }

  get transcript(): readonly Message[] {
    return this._transcript.slice();
  }

  get lockedTerms(): readonly string[] {
    return this._lockedTerms.slice();
  }

  get turn(): number {
    return this.turnCounter;
  }

  async submit(studentMessage: string, onStage?: (stage: TurnStage) => void): Promise<TurnResult> {
    const turn = ++this.turnCounter;
    const lockedBefore = [...this._lockedTerms];

    this._transcript.push({ role: 'student', content: studentMessage });

    let unlockedThisTurn: string[] = [];
    if (shouldJudgeUnlock(studentMessage, this._lockedTerms) && this._lockedTerms.length > 0) {
      let prevTeacher = '';
      for (let i = this._transcript.length - 1; i >= 0; i--) {
        const msg = this._transcript[i]!;
        if (msg.role === 'teacher') {
          prevTeacher = msg.content;
          break;
        }
      }
      onStage?.('unlock');
      const result = await judgeUnlock(
        this.unlockClient, this._lockedTerms, prevTeacher, studentMessage, this.models.unlock.model,
      );
      unlockedThisTurn = result.unlocked;
      for (const term of unlockedThisTurn) {
        const idx = this._lockedTerms.indexOf(term);
        if (idx !== -1) this._lockedTerms.splice(idx, 1);
      }
    }

    onStage?.('draft');
    let t = await teacherTurn(
      this.teacherClient, this.card, this._transcript, this._lockedTerms, this.models.teacher.model,
    );
    onStage?.('gate');
    let verdict = await gateCheck(
      this.gateClient, this.card, t.mode, studentMessage, t.reply, this._lockedTerms, this.models.gate.model,
    );
    let redrafted = false;

    if (verdict.verdict === 'REVISE') {
      onStage?.('redraft');
      t = await teacherTurn(
        this.teacherClient, this.card, this._transcript, this._lockedTerms, this.models.teacher.model,
        { rejectedDraft: t.reply, note: verdict.note },
      );
      onStage?.('gate');
      verdict = await gateCheck(
        this.gateClient, this.card, t.mode, studentMessage, t.reply, this._lockedTerms, this.models.gate.model,
      );
      redrafted = true;
    }

    this._transcript.push({ role: 'teacher', content: t.reply });

    await this.tracer.endTurn({
      turn,
      ts: new Date().toISOString(),
      studentMsg: studentMessage,
      lockedBefore,
      lockedAfter: [...this._lockedTerms],
      unlocked: unlockedThisTurn,
      redrafted,
      finalMode: t.mode,
      finalReply: t.reply,
      finalVerdict: verdict,
    });

    return {
      mode: t.mode,
      reply: t.reply,
      gate: verdict,
      redrafted,
      unlockedThisTurn,
    };
  }
}
