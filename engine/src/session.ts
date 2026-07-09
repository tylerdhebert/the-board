import { gateCheck } from './gate.js';
import type { LLMClient } from './llm.js';
import { teacherTurn } from './teacher.js';
import { NullTracer, TracingLLMClient, type Tracer } from './trace.js';
import type { GateVerdict, Message, ProblemCard, TutorMode } from './types.js';
import { judgeUnlock } from './unlockJudge.js';

export interface SessionModels { teacher: string; gate: string; unlock: string }

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
  private readonly client: LLMClient;
  private readonly models: SessionModels;
  private readonly tracer: Tracer;
  private readonly _transcript: Message[] = [];
  private readonly _lockedTerms: string[];
  private turnCounter = 0;

  constructor(
    client: LLMClient,
    card: ProblemCard,
    models: SessionModels,
    tracer: Tracer = new NullTracer(),
  ) {
    this.client = new TracingLLMClient(client, tracer);
    this.card = card;
    this.models = models;
    this.tracer = tracer;
    this._lockedTerms = [...card.leak_terms];
  }

  get transcript(): readonly Message[] {
    return this._transcript.slice();
  }

  get lockedTerms(): readonly string[] {
    return this._lockedTerms.slice();
  }

  async submit(studentMessage: string): Promise<TurnResult> {
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
      const result = await judgeUnlock(
        this.client, this._lockedTerms, prevTeacher, studentMessage, this.models.unlock,
      );
      unlockedThisTurn = result.unlocked;
      for (const term of unlockedThisTurn) {
        const idx = this._lockedTerms.indexOf(term);
        if (idx !== -1) this._lockedTerms.splice(idx, 1);
      }
    }

    let t = await teacherTurn(
      this.client, this.card, this._transcript, this._lockedTerms, this.models.teacher,
    );
    let verdict = await gateCheck(
      this.client, this.card, t.mode, studentMessage, t.reply, this._lockedTerms, this.models.gate,
    );
    let redrafted = false;

    if (verdict.verdict === 'REVISE') {
      t = await teacherTurn(
        this.client, this.card, this._transcript, this._lockedTerms, this.models.teacher,
        { rejectedDraft: t.reply, note: verdict.note },
      );
      verdict = await gateCheck(
        this.client, this.card, t.mode, studentMessage, t.reply, this._lockedTerms, this.models.gate,
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
