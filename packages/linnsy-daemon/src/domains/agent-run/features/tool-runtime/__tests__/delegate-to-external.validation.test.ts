import { describe, expect, test } from 'vitest';

import {
  LINNSY_ERROR_CODES,
  createDelegateToExternalTool,
  createLinnsyAgentRegistry,
  createWorkspaceManager,
  expectLinnsyError,
  externalDefinition,
  linnsyLocator,
  noopDispatcher,
  setup,
  toolContext
} from './scenarios/delegate-to-external-support.js';

describe('delegate_to_external validation', () => {
  test('rejects omitted locator when no path manager is available', async () => {
    const fixture = await setup();
    const registry = createLinnsyAgentRegistry({
      definitions: [externalDefinition()],
      autoRegisterMain: false,
      defaultAgentId: 'delegate_to_codex'
    });
    const tool = createDelegateToExternalTool({
      registry,
      taskTracker: fixture.tracker,
      workspace: createWorkspaceManager({ root: fixture.workspaceRoot }),
      dispatcher: noopDispatcher(),
      taskIdFactory: () => 'task_no_path_manager'
    });

    await expectLinnsyError(tool.execute({
      definitionKey: 'delegate_to_codex',
      title: 'Needs default work dir',
      payload: { prompt: 'make a file' }
    }, toolContext()), LINNSY_ERROR_CODES.TASK_LOCATOR_INVALID, 'pathManager');
  });

  test('fails before creating a task when definitionKey is not registered', async () => {
    const fixture = await setup();
    const registry = createLinnsyAgentRegistry({
      definitions: [externalDefinition()],
      autoRegisterMain: false,
      defaultAgentId: 'delegate_to_codex'
    });
    const tool = createDelegateToExternalTool({
      registry,
      taskTracker: fixture.tracker,
      workspace: createWorkspaceManager({ root: fixture.workspaceRoot }),
      dispatcher: noopDispatcher(),
      taskIdFactory: () => 'task_missing'
    });

    await expect(tool.execute({
      definitionKey: 'missing',
      title: 'No task',
      locator: linnsyLocator()
    }, toolContext())).rejects.toMatchObject({ code: LINNSY_ERROR_CODES.DEFINITION_NOT_FOUND });
    await expect(fixture.tracker.get('task_missing')).resolves.toBeNull();
  });

  test('rejects invalid locator before creating a task', async () => {
    const fixture = await setup();
    const registry = createLinnsyAgentRegistry({
      definitions: [externalDefinition()],
      autoRegisterMain: false,
      defaultAgentId: 'delegate_to_codex'
    });
    const tool = createDelegateToExternalTool({
      registry,
      taskTracker: fixture.tracker,
      workspace: createWorkspaceManager({ root: fixture.workspaceRoot }),
      dispatcher: noopDispatcher(),
      taskIdFactory: () => 'task_unsafe'
    });

    await expectLinnsyError(tool.execute({
      definitionKey: 'delegate_to_codex',
      title: 'Invalid locator',
      locator: { kind: 'none', label: 'bad', ref: 'should-not-exist' },
      payload: { prompt: 'say hello' }
    }, toolContext()), LINNSY_ERROR_CODES.TASK_LOCATOR_INVALID, 'must be omitted');
    await expect(fixture.tracker.get('task_unsafe')).resolves.toBeNull();
  });

});
