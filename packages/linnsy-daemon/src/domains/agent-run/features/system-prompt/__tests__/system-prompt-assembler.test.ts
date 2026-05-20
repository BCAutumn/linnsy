import { describe, expect, test } from 'vitest';

import { createLinnsyMainAgentDefinition } from '../../agents/index.js';
import {
  buildSystemPromptCacheKey,
  composeSystemPrompt,
  createSystemPromptAssembler,
  DEFAULT_SHAPING_VERSION
} from '../system-prompt-assembler.js';

describe('composeSystemPrompt', () => {
  test('renders system role sections in the product order', () => {
    const definition = createLinnsyMainAgentDefinition({
      basePrompt: 'Base prompt for {{agent.display_name}}.',
      modelPolicy: { model: 'gpt-5', fallbackChain: ['claude-sonnet'], reasoningEffort: 'medium' },
      toolPolicy: { allowedToolIds: ['mcp.search'], approvalRequiredToolIds: ['mcp.delete'] }
    });
    const prompt = composeSystemPrompt(
      {
        definition,
        conversationId: 'conv_1',
        shaping: {
          memoryRecall: [
            { memoryId: 'm1', scope: 'long_term_memory', body: 'Linnsy has editable memory.' }
          ],
          extraSections: [
            { heading: 'linnsy_persona', body: '- Persona: steady secretary.' },
            { heading: 'work_style', body: '- Work style: ask less, do more.' },
            { heading: 'user_preference', body: '- User preference: concise Chinese.' }
          ]
        }
      },
      DEFAULT_SHAPING_VERSION
    );
    expect(prompt).toMatchInlineSnapshot(`
      "Base prompt for Linnsy.

      [linnsy_persona]
      - Persona: steady secretary.

      [work_style]
      - Work style: ask less, do more.

      [user_preference]
      - User preference: concise Chinese.

      [long_term_memory]
      Linnsy has editable memory."
    `);
  });

  test('uses owner editable system prompt override as the base prompt', () => {
    const definition = createLinnsyMainAgentDefinition({
      basePrompt: 'Default base prompt.'
    });
    const prompt = composeSystemPrompt(
      {
        definition,
        conversationId: 'conv_1',
        shaping: {
          systemPromptOverride: 'Owner edited prompt for {{agent.display_name}}.'
        }
      },
      DEFAULT_SHAPING_VERSION
    );

    expect(prompt).toContain('Owner edited prompt for Linnsy.');
    expect(prompt).not.toContain('Default base prompt.');
  });
});

describe('createSystemPromptAssembler', () => {
  test('returns reused=true when cache key matches', () => {
    const definition = createLinnsyMainAgentDefinition();
    const assembler = createSystemPromptAssembler({
      clock: { now: () => 1_000 }
    });

    const first = assembler.assemble({ definition, conversationId: 'conv_1' });
    const second = assembler.assemble({ definition, conversationId: 'conv_1' });
    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(second.cacheKey).toBe(
      buildSystemPromptCacheKey({
        definitionId: definition.id,
        conversationId: 'conv_1',
        shapingVersion: DEFAULT_SHAPING_VERSION
      })
    );
    expect(second.systemPrompt).toBe(first.systemPrompt);
    expect(second.composedAt).toBe(1_000);
  });

  test('reuses prompts across minute changes because time lives in user context', () => {
    let now = 1_000;
    const definition = createLinnsyMainAgentDefinition({
      basePrompt: 'Base prompt.'
    });
    const assembler = createSystemPromptAssembler({
      clock: { now: () => now }
    });

    const first = assembler.assemble({ definition, conversationId: 'conv_1' });
    now = 61_000;
    const second = assembler.assemble({ definition, conversationId: 'conv_1' });

    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(first.cacheKey).toBe(second.cacheKey);
    expect(second.systemPrompt).toBe('Base prompt.');
  });

  test('different shapingVersion produces a fresh entry', () => {
    const definition = createLinnsyMainAgentDefinition();
    const assembler = createSystemPromptAssembler();
    const v1 = assembler.assemble({ definition, conversationId: 'conv_1' });
    const v2 = assembler.assemble({ definition, conversationId: 'conv_1', shapingVersion: 'next.v2' });
    expect(v1.reused).toBe(false);
    expect(v2.reused).toBe(false);
    expect(v1.cacheKey).not.toBe(v2.cacheKey);
  });

  test('invalidate removes only entries belonging to the conversation', () => {
    const definition = createLinnsyMainAgentDefinition();
    const assembler = createSystemPromptAssembler();
    assembler.assemble({ definition, conversationId: 'conv_1' });
    assembler.assemble({ definition, conversationId: 'conv_1', shapingVersion: 'v2' });
    assembler.assemble({ definition, conversationId: 'conv_2' });

    const removed = assembler.invalidate('conv_1');
    expect(removed).toBe(2);

    const reuseConv1 = assembler.assemble({ definition, conversationId: 'conv_1' });
    const reuseConv2 = assembler.assemble({ definition, conversationId: 'conv_2' });
    expect(reuseConv1.reused).toBe(false);
    expect(reuseConv2.reused).toBe(true);
  });

  test('LRU eviction respects cacheCapacity', () => {
    const definition = createLinnsyMainAgentDefinition();
    const assembler = createSystemPromptAssembler({ cacheCapacity: 2 });
    assembler.assemble({ definition, conversationId: 'a' });
    assembler.assemble({ definition, conversationId: 'b' });
    assembler.assemble({ definition, conversationId: 'a' }); // promote 'a'
    assembler.assemble({ definition, conversationId: 'c' }); // evict 'b'

    expect(assembler.assemble({ definition, conversationId: 'a' }).reused).toBe(true);
    expect(assembler.assemble({ definition, conversationId: 'b' }).reused).toBe(false);
    expect(assembler.invalidate('a')).toBe(1);
  });
});
