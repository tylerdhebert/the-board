import { gateCheck } from './gate.js';
import { artifactTextForGate, artifactTurn, type TutorArtifact } from './artifact.js';
import type { LLMClient } from './llm.js';
import { createClient } from './providers.js';
import { teacherTurn, type TeacherGesture, type TeacherTurnContext } from './teacher.js';
import { NullTracer, TracingLLMClient, type Tracer } from './trace.js';
import type { GateVerdict, Message, ProblemCard, TutorMode } from './types.js';
import { judgeReveal, judgeUnlock } from './unlockJudge.js';

export interface RoleConfig { backend: string; model: string }
export interface SessionModels { teacher: RoleConfig; gate: RoleConfig; unlock: RoleConfig }

export type TurnStage = 'unlock' | 'draft' | 'gate' | 'redraft' | 'artifact';

export type { TeacherGesture };

export interface TurnResult {
  mode: TutorMode;
  reply: string;
  gate: GateVerdict;
  redrafted: boolean;
  unlockedThisTurn: string[];
  gesture?: TeacherGesture;
  artifact?: TutorArtifact;
}

/** Optional board context for the teacher only (cwd + rendered BOARD lines). */
export type SubmitTurnContext = TeacherTurnContext;

export interface SubmitOptions {
  /** Off the record: no gate, no withholding; reveals are unlocked after the fact. */
  direct?: boolean;
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

function showCaseInput(card: ProblemCard, caseNumber: number): string {
  const examples = card.examples;
  if (caseNumber <= examples.length) {
    return examples[caseNumber - 1]!.input;
  }
  const stress = card.stress ?? [];
  return stress[caseNumber - 1 - examples.length]!.input;
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

  /** Drop out-of-range SHOW / empty-board TAP before gate + result. */
  private acceptGesture(gesture: TeacherGesture | undefined): TeacherGesture | undefined {
    if (!gesture) return undefined;
    if (gesture.kind === 'show') {
      const total = this.card.examples.length + (this.card.stress?.length ?? 0);
      if (gesture.caseNumber < 1 || gesture.caseNumber > total) return undefined;
      return gesture;
    }
    if (gesture.kind === 'tap') {
      if (this._lockedTerms.length === 0) return undefined;
      return gesture;
    }
    return gesture;
  }

  private gateDraft(reply: string, gesture: TeacherGesture | undefined): string {
    if (!gesture) return reply;
    if (gesture.kind === 'point') {
      const where = gesture.endLine
        ? `lines ${gesture.line}–${gesture.endLine}`
        : `line ${gesture.line}`;
      return reply + `\n\n[gesture: points at editor ${where}: \`${gesture.quote}\`]`;
    }
    if (gesture.kind === 'show') {
      const input = showCaseInput(this.card, gesture.caseNumber);
      return reply + `\n\n[gesture: shows the class case ${gesture.caseNumber}: \`${input}\`]`;
    }
    return reply + `\n\n[gesture: taps the vocab board without revealing anything]`;
  }

  private async authorArtifact(
    concept: string | undefined,
    mode: TutorMode,
    studentMessage: string,
    onStage: ((stage: TurnStage) => void) | undefined,
    turnContext: SubmitTurnContext | undefined,
    direct: boolean,
  ): Promise<{
    artifact?: TutorArtifact;
    trace?: { title: string; gate: GateVerdict | 'direct' | 'dropped' };
  }> {
    if (!concept) return {};
    onStage?.('artifact');
    try {
      const artifact = await artifactTurn(
        this.teacherClient, this.card, this._transcript, this._lockedTerms,
        this.models.teacher.model, mode, concept, turnContext,
      );
      if (!artifact) return { trace: { title: concept, gate: 'dropped' } };
      if (direct) return { artifact, trace: { title: artifact.title, gate: 'direct' } };
      const gate = await gateCheck(
        this.gateClient, this.card, mode, studentMessage,
        artifactTextForGate(artifact.title, artifact.html), this._lockedTerms, this.models.gate.model,
      );
      if (gate.verdict === 'REVISE') {
        return { trace: { title: artifact.title, gate: 'dropped' } };
      }
      return { artifact, trace: { title: artifact.title, gate } };
    } catch {
      return { trace: { title: concept, gate: 'dropped' } };
    }
  }

  /** Off-the-record turn: full-context teacher, no gate; unlock reveals after. */
  private async submitDirect(
    studentMessage: string,
    turn: number,
    lockedBefore: string[],
    onStage?: (stage: TurnStage) => void,
    turnContext?: SubmitTurnContext,
  ): Promise<TurnResult> {
    onStage?.('draft');
    let t = await teacherTurn(
      this.teacherClient, this.card, this._transcript, this._lockedTerms, this.models.teacher.model,
      undefined,
      turnContext,
      true,
    );
    t = { ...t, gesture: this.acceptGesture(t.gesture) };

    let unlockedThisTurn: string[] = [];
    if (this._lockedTerms.length > 0) {
      onStage?.('unlock');
      try {
        const result = await judgeReveal(
          this.unlockClient, this._lockedTerms, studentMessage, t.reply, this.models.unlock.model,
        );
        unlockedThisTurn = result.unlocked;
        for (const term of unlockedThisTurn) {
          const idx = this._lockedTerms.indexOf(term);
          if (idx !== -1) this._lockedTerms.splice(idx, 1);
        }
      } catch {
        // The reply already exists — a bookkeeping failure must not eat it.
        // Worst case a revealed term stays locked and the reveal judge gets
        // another look next direct turn.
      }
    }

    const verdict: GateVerdict = { verdict: 'PASS', offense: 'none', note: 'direct mode — gate off' };
    this._transcript.push({ role: 'teacher', content: t.reply });
    const authored = await this.authorArtifact(
      t.artifact?.title, t.mode, studentMessage, onStage, turnContext, true,
    );

    await this.tracer.endTurn({
      turn,
      ts: new Date().toISOString(),
      studentMsg: studentMessage,
      lockedBefore,
      lockedAfter: [...this._lockedTerms],
      unlocked: unlockedThisTurn,
      redrafted: false,
      finalMode: t.mode,
      finalReply: t.reply,
      finalVerdict: verdict,
      ...(authored.trace ? { artifact: authored.trace } : {}),
    });

    return {
      mode: t.mode,
      reply: t.reply,
      gate: verdict,
      redrafted: false,
      unlockedThisTurn,
      ...(t.gesture ? { gesture: t.gesture } : {}),
      ...(authored.artifact ? { artifact: authored.artifact } : {}),
    };
  }

  async submit(
    studentMessage: string,
    onStage?: (stage: TurnStage) => void,
    turnContext?: SubmitTurnContext,
    opts?: SubmitOptions,
  ): Promise<TurnResult> {
    const turn = ++this.turnCounter;
    const lockedBefore = [...this._lockedTerms];

    this._transcript.push({ role: 'student', content: studentMessage });

    if (opts?.direct) {
      return this.submitDirect(studentMessage, turn, lockedBefore, onStage, turnContext);
    }

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
      undefined,
      turnContext,
    );
    t = { ...t, gesture: this.acceptGesture(t.gesture) };
    onStage?.('gate');
    let verdict = await gateCheck(
      this.gateClient, this.card, t.mode, studentMessage,
      this.gateDraft(t.reply, t.gesture), this._lockedTerms, this.models.gate.model,
    );
    let redrafted = false;

    if (verdict.verdict === 'REVISE') {
      onStage?.('redraft');
      t = await teacherTurn(
        this.teacherClient, this.card, this._transcript, this._lockedTerms, this.models.teacher.model,
        { rejectedDraft: t.reply, note: verdict.note },
        turnContext,
      );
      t = { ...t, gesture: this.acceptGesture(t.gesture) };
      onStage?.('gate');
      verdict = await gateCheck(
        this.gateClient, this.card, t.mode, studentMessage,
        this.gateDraft(t.reply, t.gesture), this._lockedTerms, this.models.gate.model,
      );
      redrafted = true;
    }

    this._transcript.push({ role: 'teacher', content: t.reply });
    const authored = await this.authorArtifact(
      t.artifact?.title, t.mode, studentMessage, onStage, turnContext, false,
    );

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
      ...(authored.trace ? { artifact: authored.trace } : {}),
    });

    return {
      mode: t.mode,
      reply: t.reply,
      gate: verdict,
      redrafted,
      unlockedThisTurn,
      ...(t.gesture ? { gesture: t.gesture } : {}),
      ...(authored.artifact ? { artifact: authored.artifact } : {}),
    };
  }
}
