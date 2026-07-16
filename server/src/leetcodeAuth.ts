import type { LeetCodeAuth } from '../../engine/src/lcOracle.js';
import { deleteSetting, getSetting, setSetting } from './sessionStore.js';

export async function loadLeetCodeAuth(): Promise<LeetCodeAuth | null> {
  const raw = await getSetting('leetcode');
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw) as { session?: unknown; csrf?: unknown };
    if (
      typeof parsed.session !== 'string' ||
      !parsed.session.trim() ||
      typeof parsed.csrf !== 'string' ||
      !parsed.csrf.trim()
    ) {
      return null;
    }
    return { session: parsed.session, csrf: parsed.csrf };
  } catch {
    return null;
  }
}

export async function saveLeetCodeAuth(auth: LeetCodeAuth): Promise<void> {
  if (!auth.session.trim() || !auth.csrf.trim()) {
    throw new Error('session and csrf must be non-empty strings');
  }
  await setSetting('leetcode', JSON.stringify({ session: auth.session, csrf: auth.csrf }));
}

export async function clearLeetCodeAuth(): Promise<void> {
  await deleteSetting('leetcode');
}
