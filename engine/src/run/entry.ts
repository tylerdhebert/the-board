import type { RunnableLang } from './types.js';

export function detectEntryPoint(
  code: string,
  language: RunnableLang,
  scaffold?: string,
): string | null {
  const sources = [code, scaffold ?? ''];
  for (const src of sources) {
    if (!src) continue;
    if (language === 'python') {
      const method = src.match(/def (\w+)\(self/);
      if (method) return method[1]!;
      const top = src.match(/^def (\w+)\(/m);
      if (top) return top[1]!;
    } else if (language === 'typescript' || language === 'javascript') {
      const fn = src.match(/function (\w+)\s*\(/);
      if (fn) return fn[1]!;
      const arrow = src.match(/(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\(/);
      if (arrow) return arrow[1]!;
    } else if (language === 'csharp') {
      const m = src.match(/public\s+(?!class)[\w<>\[\],?\s]+?\s+(\w+)\s*\(/);
      if (m) return m[1]!;
    }
  }
  return null;
}
