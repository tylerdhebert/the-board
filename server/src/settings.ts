import { DEFAULT_MODELS } from './engine.js';
import { getSetting, setSetting } from './sessionStore.js';

export type RoleModels = { backend: string; model: string };
export type AppSettings = {
  models: {
    teacher: RoleModels;
    gate: RoleModels;
    unlock: RoleModels;
    ingest: RoleModels;
  };
};

const BACKENDS = new Set(['codex', 'claude']);

const DEFAULT_SETTINGS: AppSettings = {
  models: {
    teacher: { ...DEFAULT_MODELS.teacher },
    gate: { ...DEFAULT_MODELS.gate },
    unlock: { ...DEFAULT_MODELS.unlock },
    ingest: { backend: 'codex', model: 'gpt-5.5' },
  },
};

function isRoleModels(v: unknown): v is RoleModels {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return typeof r.backend === 'string' && typeof r.model === 'string';
}

function mergeRole(base: RoleModels, override: unknown): RoleModels {
  if (!isRoleModels(override)) return { ...base };
  return {
    backend: override.backend,
    model: override.model,
  };
}

function deepMergeModels(raw: unknown): AppSettings['models'] {
  const src =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    teacher: mergeRole(DEFAULT_SETTINGS.models.teacher, src.teacher),
    gate: mergeRole(DEFAULT_SETTINGS.models.gate, src.gate),
    unlock: mergeRole(DEFAULT_SETTINGS.models.unlock, src.unlock),
    ingest: mergeRole(DEFAULT_SETTINGS.models.ingest, src.ingest),
  };
}

export async function loadSettings(): Promise<AppSettings> {
  const raw = await getSetting('models');
  if (raw == null) return structuredClone(DEFAULT_SETTINGS);
  try {
    const parsed: unknown = JSON.parse(raw);
    return { models: deepMergeModels(parsed) };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

function validateRole(name: string, role: RoleModels): void {
  if (!BACKENDS.has(role.backend)) {
    throw new Error(
      `invalid backend for ${name}: "${role.backend}" (expected codex or claude)`,
    );
  }
  const model = typeof role.model === 'string' ? role.model.trim() : '';
  if (!model) {
    throw new Error(`invalid model for ${name}: must be a non-empty string`);
  }
  role.model = model;
}

export async function saveSettings(s: AppSettings): Promise<void> {
  if (!s?.models) {
    throw new Error('settings.models is required');
  }
  const roles = ['teacher', 'gate', 'unlock', 'ingest'] as const;
  for (const name of roles) {
    const role = s.models[name];
    if (!role || typeof role !== 'object') {
      throw new Error(`settings.models.${name} is required`);
    }
    validateRole(name, role);
  }
  await setSetting('models', JSON.stringify(s.models));
}
