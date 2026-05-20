import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import type { OpenAIToolSchema, ToolExecutionContext } from '@linnlabs/linnkit/runtime-kernel';

import { createTempLinnsyHome } from '../../../../../../__tests__/harness/temp-home.js';
import { FileToolResultStore } from '../../../../../persistence/stores/file-tool-result/file-tool-result-store.js';
import { isRecord } from '../../../../../shared/json.js';
import { createToolResultGuard } from '../tool-result-guard.js';
import { createLinnsyToolRuntime } from '../tool-runtime.js';
import { toJsonObjectSchema, type LinnsyTool } from '../types.js';

const homes: string[] = [];

afterEach(async () => {
  while (homes.length > 0) {
    const home = homes.pop();
    if (home !== undefined) {
      await rm(home, { recursive: true, force: true });
    }
  }
});

describe('ToolResultGuard', () => {
  test('passes through small tool observations', async () => {
    const home = await createTempLinnsyHome();
    homes.push(home);
    const workspacePath = join(home, 'workspaces', 'task_1');
    const runtime = createLinnsyToolRuntime({
      resultGuard: createToolResultGuard({
        maxChars: 1_000,
        store: new FileToolResultStore()
      }),
      tools: [fakeTool({ workspacePath, output: { ok: true }, observation: 'small observation' })]
    });

    const result = await runtime.executeTool('fake_tool', {}, toolContext());

    expect(result.success).toBe(true);
    expect(result.result).toBe('small observation');
  });

  test('truncates oversized tool observations and persists the full payload in workspace outputs', async () => {
    const home = await createTempLinnsyHome();
    homes.push(home);
    const workspacePath = join(home, 'workspaces', 'task_1');
    const runtime = createLinnsyToolRuntime({
      resultGuard: createToolResultGuard({
        maxChars: 100,
        summaryChars: 20,
        store: new FileToolResultStore()
      }),
      tools: [fakeTool({
        workspacePath,
        output: { blob: 'x'.repeat(200) },
        observation: `long observation ${'x'.repeat(200)}`
      })]
    });

    const result = await runtime.executeTool('fake_tool', {}, toolContext());

    expect(result.success).toBe(true);
    const guarded = readGuardedResult(result.result);
    expect(guarded.truncated).toBe(true);
    expect(guarded.summary).toContain('long observation');
    expect(guarded.ref).toBe(`file://${join(workspacePath, 'outputs', 'tool-result-call_1.json')}`);
    const persisted = await readFile(join(workspacePath, 'outputs', 'tool-result-call_1.json'), 'utf8');
    expect(persisted).toContain(`long observation ${'x'.repeat(200)}`);
  });
});

function fakeTool(input: { workspacePath: string; output: Record<string, unknown>; observation: string }): LinnsyTool {
  return {
    name: 'fake_tool',
    description: 'Fake tool',
    definition: {
      parameters: {
        type: 'object',
        properties: {}
      }
    },
    getSchema(): OpenAIToolSchema {
      return {
        type: 'function',
        function: {
          name: 'fake_tool',
          description: 'Fake tool',
          parameters: toJsonObjectSchema(this.definition.parameters)
        }
      };
    },
    execute() {
      return Promise.resolve({
        data: {
          workspacePath: input.workspacePath,
          ...input.output
        },
        observation: input.observation
      });
    }
  };
}

function toolContext(): ToolExecutionContext {
  return {
    runId: 'run_1',
    conversationId: 'conv_1',
    turnId: 'turn_1',
    parentToolCallId: 'call_1'
  };
}

function readGuardedResult(value: string | undefined): { truncated?: boolean; ref?: string; summary?: string } {
  const parsed = JSON.parse(value ?? '{}') as unknown;
  if (!isRecord(parsed)) {
    throw new Error('guarded result must be a JSON object');
  }
  return {
    ...(typeof parsed.truncated === 'boolean' ? { truncated: parsed.truncated } : {}),
    ...(typeof parsed.ref === 'string' ? { ref: parsed.ref } : {}),
    ...(typeof parsed.summary === 'string' ? { summary: parsed.summary } : {})
  };
}
