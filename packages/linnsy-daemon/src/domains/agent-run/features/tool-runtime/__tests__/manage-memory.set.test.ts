import { describe, expect, test } from 'vitest';

import { MEMORY_ERROR_CODES } from '../../../../memory/persistence/memory-store-port.js';
import { LINNSY_ERROR_CODES } from '../../../../../shared/errors.js';
import { createFixture, expectLinnsyError, toolContext } from './scenarios/manage-memory-support.js';

describe('manage_memory set', () => {
  test('writes approved long-term memory with agent audit metadata', async () => {
    const fixture = createFixture({
      now: () => 123_456,
      memoryIdFactory: () => 'ltm_1'
    });

    const result = await fixture.tool.execute({
      op: 'set',
      scope: 'long_term_memory',
      body: 'linnsy 项目=~/code/linnsy'
    }, toolContext());

    expect(result.data).toEqual({
      op: 'set',
      memoryId: 'ltm_1',
      scope: 'long_term_memory',
      body: 'linnsy 项目=~/code/linnsy'
    });
    expect(result.observation).toContain('已记住');
    expect(fixture.store.get('ltm_1')).toMatchObject({
      memoryId: 'ltm_1',
      scope: 'long_term_memory',
      body: 'linnsy 项目=~/code/linnsy',
      metadata: {
        source: 'agent_tool',
        writtenByAgent: 'linnsy_main',
        writtenAtConversationId: 'conv_1',
        writtenAtRunId: 'run_1',
        writtenAt: 123_456
      }
    });
  });

  test('writes user preference with pref id prefix', async () => {
    const fixture = createFixture({
      memoryIdFactory: (scope) => scope === 'user_preference' ? 'pref_1' : 'ltm_1'
    });

    const result = await fixture.tool.execute({
      op: 'set',
      scope: 'user_preference',
      body: '主人喜欢被叫老板'
    }, toolContext());

    expect(result.data.memoryId).toBe('pref_1');
    expect(fixture.store.get('pref_1')).toMatchObject({
      scope: 'user_preference',
      body: '主人喜欢被叫老板'
    });
  });

  test('overwrites an existing non-builtin memory id', async () => {
    const fixture = createFixture();
    fixture.store.seed({
      memoryId: 'ltm_existing',
      scope: 'long_term_memory',
      body: '旧项目位置',
      createdAt: 1,
      updatedAt: 1
    });

    const result = await fixture.tool.execute({
      op: 'set',
      memoryId: 'ltm_existing',
      scope: 'long_term_memory',
      body: 'linnsy 项目=~/code/linnsy'
    }, toolContext());

    expect(result.data.memoryId).toBe('ltm_existing');
    expect(fixture.store.get('ltm_existing')).toMatchObject({
      body: 'linnsy 项目=~/code/linnsy',
      createdAt: 1
    });
  });

  test('rejects non-writable scopes', async () => {
    const fixture = createFixture();

    await expectLinnsyError(
      fixture.tool.execute({
        op: 'set',
        scope: 'system_prompt',
        body: '改掉底层提示词'
      }, toolContext()),
      LINNSY_ERROR_CODES.MEMORY_SCOPE_NOT_WRITABLE,
      'scope'
    );
  });

  test('rejects builtin memory ids before writing', async () => {
    const fixture = createFixture();

    await expectLinnsyError(
      fixture.tool.execute({
        op: 'set',
        memoryId: 'builtin:linnsy_main:long_term_memory',
        scope: 'long_term_memory',
        body: '覆盖内置占位符'
      }, toolContext()),
      LINNSY_ERROR_CODES.MEMORY_BUILTIN_PROTECTED,
      'builtin'
    );
    expect(await fixture.store.list()).toEqual([]);
  });

  test('rejects body larger than 4KB', async () => {
    const fixture = createFixture();

    await expectLinnsyError(
      fixture.tool.execute({
        op: 'set',
        scope: 'long_term_memory',
        body: 'a'.repeat(4_097)
      }, toolContext()),
      LINNSY_ERROR_CODES.MEMORY_BODY_TOO_LARGE,
      '4096'
    );
  });

  test('rejects empty body', async () => {
    const fixture = createFixture();

    await expectLinnsyError(
      fixture.tool.execute({
        op: 'set',
        scope: 'long_term_memory',
        body: '   '
      }, toolContext()),
      MEMORY_ERROR_CODES.ITEM_INVALID,
      'body'
    );
  });
});
