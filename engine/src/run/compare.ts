import type { Judge } from '../types.js';

export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      // fall through to any-order check below only when lengths match after sort path
    } else if (a.every((v, i) => deepEqual(v, b[i]))) {
      return true;
    }
    // any-order leniency (mirrors verifyCard)
    try {
      const sa = [...a].map((x) => JSON.stringify(x)).sort();
      const sb = [...b].map((x) => JSON.stringify(x)).sort();
      return sa.length === sb.length && sa.every((v, i) => v === sb[i]);
    } catch {
      return false;
    }
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const ak = Object.keys(ao);
    const bk = Object.keys(bo);
    if (ak.length !== bk.length) return false;
    return ak.every((k) => deepEqual(ao[k], bo[k]));
  }
  return false;
}

/** Strict ordered equality — no any-order fallback at any nesting level. */
export function strictDeepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => strictDeepEqual(v, b[i]));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const ak = Object.keys(ao);
    const bk = Object.keys(bo);
    if (ak.length !== bk.length) return false;
    return ak.every((k) => strictDeepEqual(ao[k], bo[k]));
  }
  return false;
}

export function compareGot(got: unknown, expected: unknown, judge?: Judge): boolean {
  if (judge?.kind === 'in-place') {
    return strictDeepEqual(got, expected);
  }
  if (judge?.kind === 'k-prefix') {
    const g = got as { k?: unknown; prefix?: unknown } | null;
    const e = expected as { k?: unknown; prefix?: unknown } | null;
    if (!g || !e || typeof g !== 'object' || typeof e !== 'object') return false;
    if (g.k !== e.k) return false;
    return deepEqual(g.prefix, e.prefix);
  }
  return deepEqual(got, expected);
}
