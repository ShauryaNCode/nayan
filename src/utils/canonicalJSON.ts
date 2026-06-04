type JSONLike =
  | null
  | string
  | number
  | boolean
  | JSONLike[]
  | {[key: string]: JSONLike};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
  );
}

function normalize(value: unknown): JSONLike | undefined {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    return undefined;
  }

  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalize(item) ?? null);
  }

  if (isPlainObject(value)) {
    const sorted: {[key: string]: JSONLike} = {};
    for (const key of Object.keys(value).sort()) {
      const normalizedValue = normalize(value[key]);
      if (normalizedValue !== undefined) {
        sorted[key] = normalizedValue;
      }
    }
    return sorted;
  }

  return String(value);
}

export const CanonicalJSON = {
  stringify(obj: Record<string, unknown>): string {
    const normalized = normalize(obj);
    if (!isPlainObject(normalized)) {
      throw new Error('[CanonicalJSON] Expected a JSON object at the root.');
    }
    return JSON.stringify(normalized);
  },
};
