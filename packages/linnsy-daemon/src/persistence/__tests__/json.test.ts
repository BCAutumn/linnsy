import { describe, expect, test } from 'vitest';

import { parseJsonObject, parseJsonValue, stringifyJsonValue } from '../json.js';

describe('persistence json helpers', () => {
  test('parses optional objects and rejects invalid shapes with clear labels', () => {
    expect(parseJsonObject(null, 'metadata')).toBeUndefined();
    expect(parseJsonObject('{"ok":true}', 'metadata')).toEqual({ ok: true });
    expect(() => parseJsonObject('[]', 'metadata')).toThrow('metadata must be a JSON object');
  });

  test('wraps JSON parser errors with caller labels', () => {
    expect(parseJsonValue('{"ok":true}', 'payload')).toEqual({ ok: true });
    expect(() => parseJsonValue('{', 'payload')).toThrow('payload contains invalid JSON');
    expect(stringifyJsonValue({ ok: true })).toBe('{"ok":true}');
  });
});
