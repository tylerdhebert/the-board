import type { Message } from './types.js';

export function fillTemplate(tpl: string, vars: Record<string, string>): string {
  let filled = tpl;
  for (const [key, value] of Object.entries(vars)) {
    // Function replacement so `$&`, `$1`, etc. inside a value are treated
    // literally (a plain-string replacement would interpret them).
    filled = filled.replaceAll(`{{${key}}}`, () => value);
  }
  const leftover = filled.match(/\{\{([^}]+)\}\}/);
  if (leftover) {
    throw new Error(`Missing template slot: ${leftover[1]}`);
  }
  return filled;
}

export function bullets(items: string[]): string {
  if (items.length === 0) return '(none)';
  return items.map((item) => `- ${item}`).join('\n');
}

export function renderTranscript(messages: Message[]): string {
  if (messages.length === 0) return '(no messages yet)';
  return messages
    .map((m) => `${m.role === 'student' ? 'STUDENT' : 'TEACHER'}: ${m.content}`)
    .join('\n');
}
