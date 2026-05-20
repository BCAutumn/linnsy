import { describe, expect, test } from 'vitest';

import { LINNSY_FENCE_KINDS } from '../fences.js';
import {
  addPendingContextFence,
  clearPendingContextFences,
  consumePendingContextFences
} from '../pending-interjections.js';

describe('pending context interjections', () => {
  test('clears pending fences by run lifecycle without consuming another run', () => {
    addPendingContextFence('run_a', {
      kind: LINNSY_FENCE_KINDS.userInterjection,
      content: 'new requirement',
      attrs: { source: 'owner-message' }
    });
    addPendingContextFence('run_b', {
      kind: LINNSY_FENCE_KINDS.userInterjection,
      content: 'keep this',
      attrs: { source: 'owner-message' }
    });

    clearPendingContextFences('run_a');

    expect(consumePendingContextFences('run_a')).toEqual([]);
    expect(consumePendingContextFences('run_b')).toEqual([
      {
        kind: LINNSY_FENCE_KINDS.userInterjection,
        content: 'keep this',
        attrs: { source: 'owner-message' }
      }
    ]);
  });
});
