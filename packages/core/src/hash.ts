/**
 * Canonical, order-independent hash of plain data. Object keys are sorted and
 * null/undefined fields are skipped, so a server-side view and a client replica built
 * from deltas hash the same.
 */
export function canonical(value: unknown): string {
  if (value === null || value === undefined) return 'n';
  switch (typeof value) {
    case 'number':
      return Number.isFinite(value) ? `d${value}` : 'x';
    case 'string':
      return `s${JSON.stringify(value)}`;
    case 'boolean':
      return value ? 't' : 'f';
    case 'object': {
      if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj)
        .filter(k => obj[k] !== null && obj[k] !== undefined)
        .sort();
      return `{${keys.map(k => `${k}:${canonical(obj[k])}`).join(',')}}`;
    }
    default:
      return 'x';
  }
}

export function fnv1a(text: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

export function hashValue(value: unknown): number {
  return fnv1a(canonical(value));
}
