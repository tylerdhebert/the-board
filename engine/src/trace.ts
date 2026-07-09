import { appendFile } from 'node:fs/promises';
import type { GateVerdict, TutorMode } from './types.js';
import type { LLMClient, LLMRequest } from './llm.js';

export interface LLMCallTrace {
  label: string; backend: string; model: string; ms: number;
  promptChars: number; outputChars: number;
  prompt: string; output: string;
}
export interface TurnTrace {
  turn: number; ts: string; studentMsg: string;
  lockedBefore: string[]; lockedAfter: string[]; unlocked: string[];
  redrafted: boolean; finalMode: TutorMode; finalReply: string; finalVerdict: GateVerdict;
  calls: LLMCallTrace[];
}
export interface Tracer {
  recordCall(call: LLMCallTrace): void;
  endTurn(meta: Omit<TurnTrace, 'calls'>): Promise<void>;
}

export class NullTracer implements Tracer {
  recordCall(_call: LLMCallTrace): void {}
  endTurn(_meta: Omit<TurnTrace, 'calls'>): Promise<void> {
    return Promise.resolve();
  }
}

export class JsonlTracer implements Tracer {
  private readonly filePath: string;
  private buffer: LLMCallTrace[] = [];

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  recordCall(call: LLMCallTrace): void {
    this.buffer.push(call);
  }

  async endTurn(meta: Omit<TurnTrace, 'calls'>): Promise<void> {
    const trace: TurnTrace = { ...meta, calls: this.buffer };
    await appendFile(this.filePath, JSON.stringify(trace) + '\n', 'utf-8');
    this.buffer = [];
  }
}

export class TracingLLMClient implements LLMClient {
  private readonly inner: LLMClient;
  private readonly tracer: Tracer;
  private readonly backend: string;

  constructor(inner: LLMClient, tracer: Tracer, backend = 'unknown') {
    this.inner = inner;
    this.tracer = tracer;
    this.backend = backend;
  }

  async complete(req: LLMRequest): Promise<string> {
    const start = Date.now();
    const output = await this.inner.complete(req);
    const ms = Date.now() - start;
    this.tracer.recordCall({
      label: req.label ?? 'unknown',
      backend: this.backend,
      model: req.model,
      ms,
      promptChars: req.prompt.length,
      outputChars: output.length,
      prompt: req.prompt,
      output,
    });
    return output;
  }
}
