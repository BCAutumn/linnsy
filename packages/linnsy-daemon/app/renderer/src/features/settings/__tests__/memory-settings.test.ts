import { describe, expect, it } from 'vitest';

import {
  applySystemPromptPreviewToDraft,
  countMemoryBodyUnits,
  MEMORY_BODY_UNIT_LIMIT,
  selectMemoryDraftForScope,
  validateMemoryDraft
} from '../memory-settings.js';
import type { MemoryItem, SystemPromptPreview } from '../../../lib/daemon-api.js';

describe('memory body unit limits', () => {
  it('counts Chinese Han characters and English words separately', () => {
    expect(countMemoryBodyUnits('主人 prefers concise weekly updates.')).toEqual({
      hanCharacters: 2,
      englishWords: 4,
      isOverLimit: false
    });
  });

  it('marks a draft invalid when either unit count exceeds the per-item limit', () => {
    const overLimitChinese = '你'.repeat(MEMORY_BODY_UNIT_LIMIT + 1);
    const overLimitEnglish = Array.from({ length: MEMORY_BODY_UNIT_LIMIT + 1 }, () => 'word').join(' ');

    expect(validateMemoryDraft({ scope: 'persona', body: overLimitChinese })).toBe('bodyLimit');
    expect(validateMemoryDraft({ scope: 'persona', body: overLimitEnglish })).toBe('bodyLimit');
  });
});

describe('memory system prompt projection', () => {
  it('uses backend preview as the editable draft projection for a scope', () => {
    const item = memoryItem({
      memoryId: 'mem_system',
      scope: 'system_prompt',
      body: 'frontend stale copy'
    });

    const selected = selectMemoryDraftForScope([item], 'system_prompt', systemPromptPreview({
      scope: 'system_prompt',
      body: 'backend effective prompt'
    }));

    expect(selected.item).toBe(item);
    expect(selected.draft).toMatchObject({
      memoryId: 'mem_system',
      scope: 'system_prompt',
      body: 'backend effective prompt'
    });
  });

  it('uses backend preview sections for every editable memory scope', () => {
    const scopes: Array<SystemPromptPreview['sections'][number]['scope']> = [
      'system_prompt',
      'persona',
      'work_style',
      'user_preference',
      'long_term_memory'
    ];
    const items = scopes.map((scope, index) => memoryItem({
      memoryId: `mem_${scope}`,
      scope,
      body: `frontend stale ${String(index)}`
    }));
    const preview = systemPromptPreview(...scopes.map((scope, index) => ({
      scope,
      body: `backend effective ${String(index)}`
    })));

    for (const [index, scope] of scopes.entries()) {
      const selected = selectMemoryDraftForScope(items, scope, preview);

      expect(selected.draft).toMatchObject({
        memoryId: `mem_${scope}`,
        scope,
        body: `backend effective ${String(index)}`
      });
    }
  });

  it('keeps the local draft body when backend preview has no matching section', () => {
    expect(applySystemPromptPreviewToDraft(
      { scope: 'persona', body: 'local persona' },
      systemPromptPreview({ scope: 'system_prompt', body: 'backend prompt' })
    )).toEqual({ scope: 'persona', body: 'local persona' });
  });
});

function memoryItem(overrides: Partial<MemoryItem>): MemoryItem {
  return {
    memoryId: 'mem_1',
    scope: 'user_preference',
    body: 'body',
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  };
}

function systemPromptPreview(...sections: Array<{
  scope: SystemPromptPreview['sections'][number]['scope'];
  body: string;
}>): SystemPromptPreview {
  const previewSections = sections.map((section) => ({
    scope: section.scope,
    heading: section.scope,
    body: section.body,
    editable: true
  }));
  return {
    agentId: 'linnsy_main',
    role: 'system',
    shapingVersion: 'v1',
    assembledPrompt: previewSections.map((section) => section.body).join('\n\n'),
    sections: previewSections
  };
}
