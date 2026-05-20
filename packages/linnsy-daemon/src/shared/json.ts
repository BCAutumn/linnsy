export function parseJsonObject(value: string | null, label: string): Record<string, unknown> | undefined {
  if (value === null) {
    return undefined;
  }

  const parsed = JSON.parse(value) as unknown;
  if (isRecord(parsed)) {
    return parsed;
  }

  throw new Error(`${label} must be a JSON object`);
}

export function parseJsonValue(value: string, label: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'unknown JSON parse error';
    throw new Error(`${label} contains invalid JSON: ${message}`);
  }
}

export function stringifyJsonValue(value: unknown): string {
  return JSON.stringify(value);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
