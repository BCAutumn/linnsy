import { describe, expect, test } from 'vitest';

import { MEMORY_ERROR_CODES } from '../../../../memory/persistence/memory-store-port.js';
import { LINNSY_ERROR_CODES } from '../../../../../shared/errors.js';
import { createFixture, expectLinnsyError, toolContext } from './scenarios/manage-memory-support.js';

describe('manage_memory forget', () => {
  test('removes an existing non-builtin memory item', async () => {
    const fixture = createFixture();
    fixture.store.seed({
      memoryId: 'ltm_project',
      scope: 'long_term_memory',
      body: 'linnsy 项目=~/code/linnsy',
      createdAt: 1,
      updatedAt: 1
    });

    const result = await fixture.tool.execute({
      op: 'forget',
      memoryId: 'ltm_project'
    }, toolContext());

    expect(result.data).toEqual({
      op: 'forget',
      memoryId: 'ltm_project'
    });
    expect(result.observation).toBe('已删除记忆 ltm_project。');
    expect(fixture.store.get('ltm_project')).toBeUndefined();
  });

  test('rejects missing memory id', async () => {
    const fixture = createFixture();

    await expectLinnsyError(
      fixture.tool.execute({
        op: 'forget'
      }, toolContext()),
      MEMORY_ERROR_CODES.ITEM_NOT_FOUND,
      'memoryId'
    );
  });

  test('rejects builtin memory ids', async () => {
    const fixture = createFixture();
    fixture.store.seed({
      memoryId: 'builtin:linnsy_main:long_term_memory',
      scope: 'long_term_memory',
      body: '内置占位符',
      createdAt: 1,
      updatedAt: 1
    });

    await expectLinnsyError(
      fixture.tool.execute({
        op: 'forget',
        memoryId: 'builtin:linnsy_main:long_term_memory'
      }, toolContext()),
      LINNSY_ERROR_CODES.MEMORY_BUILTIN_PROTECTED,
      'builtin'
    );
    expect(fixture.store.get('builtin:linnsy_main:long_term_memory')).toMatchObject({
      body: '内置占位符'
    });
  });

  test('reports not found for unknown memory ids', async () => {
    const fixture = createFixture();

    await expectLinnsyError(
      fixture.tool.execute({
        op: 'forget',
        memoryId: 'ltm_missing'
      }, toolContext()),
      MEMORY_ERROR_CODES.ITEM_NOT_FOUND,
      'ltm_missing'
    );
  });

  test('rejects unknown operations', async () => {
    const fixture = createFixture();

    await expectLinnsyError(
      fixture.tool.execute({
        op: 'delete',
        memoryId: 'ltm_project'
      }, toolContext()),
      MEMORY_ERROR_CODES.ITEM_INVALID,
      'op'
    );
  });
});
