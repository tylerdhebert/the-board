export const MAX_STRESS = 6;

export function parseInputsPayload(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((x): x is string => typeof x === 'string');
  }
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const inputs = obj.inputs ?? obj.cases ?? obj.calls;
    if (Array.isArray(inputs)) {
      return inputs.filter((x): x is string => typeof x === 'string');
    }
  }
  throw new Error('stress generation returned unexpected JSON shape (expected {"inputs":[...]})');
}
