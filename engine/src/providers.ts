import { ClaudeCliClient, CodexCliClient, type LLMClient } from './llm.js';

export type BackendName = string; // 'codex' | 'claude' today; extensible

export function createClient(backend: BackendName): LLMClient {
  if (backend === 'codex') return new CodexCliClient();
  if (backend === 'claude') return new ClaudeCliClient();
  throw new Error(`unknown backend: ${backend}`);
}
