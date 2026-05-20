import { readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { createUserMessage } from '@linnlabs/linnkit/contracts';
import { describe, expect, test } from 'vitest';

import { createTempLinnsyHome } from '../../../../../__tests__/harness/temp-home.js';
import type { LoggerPort } from '../../../../shared/ports.js';
import {
  createFileLlmRequestDebugObserver,
  noopLlmRequestDebugObserver
} from '../llm-request-debug-observer.js';

describe('LlmRequestDebugObserver', () => {
  test('does not write or log when debug observation is disabled', async () => {
    const home = await createTempLinnsyHome();
    const records: string[] = [];

    try {
      await noopLlmRequestDebugObserver.observeCanonical({
        scope: { runId: 'run_1', conversationId: 'conv_1', turnId: 'turn_1' },
        modelId: 'openai.gpt5',
        messages: [createUserMessage('user_input', 'hello')]
      });

      expect(records).toEqual([]);
      await expect(readdir(join(home, 'debug', 'llm-requests'))).rejects.toThrow();
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test('writes canonical and wire snapshots to JSONL and logs only a summary', async () => {
    const home = await createTempLinnsyHome();
    const records: Array<{ message: string; metadata?: Record<string, unknown> }> = [];
    const logger: LoggerPort = {
      info(message, metadata) {
        records.push({ message, ...(metadata === undefined ? {} : { metadata }) });
      },
      warn() {},
      error() {}
    };
    const observer = createFileLlmRequestDebugObserver({
      enabled: true,
      home,
      logger,
      maxMessageChars: 12,
      maxRecordsPerRun: 4
    });

    try {
      const scope = { runId: 'run_1', conversationId: 'conv_1', turnId: 'turn_1' };
      await observer.observeCanonical({
        scope,
        modelId: 'openai.gpt5',
        messages: [createUserMessage('user_input', 'hello from owner')]
      });
      await observer.observeWireRequest({
        scope,
        modelId: 'openai.gpt5',
        provider: 'openai',
        apiProtocol: 'openai_responses',
        stream: true,
        request: {
          model: 'gpt-5',
          headers: {
            authorization: 'Bearer local-secret-token'
          },
          api_key: 'sk-supersecret0000',
          input: [{ role: 'user', content: 'hello from owner' }]
        }
      });

      const dir = join(home, 'debug', 'llm-requests');
      const files = await readdir(dir);
      expect(files).toHaveLength(1);
      const lines = (await readFile(join(dir, files[0] ?? ''), 'utf8')).trim().split('\n');
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
        kind: 'canonical',
        runId: 'run_1',
        messageSummary: [{ role: 'user', type: 'user_input', chars: 16, preview: 'hello from o' }]
      });
      expect(JSON.parse(lines[1] ?? '{}')).toMatchObject({
        kind: 'wire',
        provider: 'openai',
        apiProtocol: 'openai_responses',
        stream: true
      });
      expect(records).toHaveLength(2);
      expect(records[0]?.message).toBe('llm request debug snapshot written');
      expect(records[0]?.metadata).toMatchObject({
        runId: 'run_1',
        modelId: 'openai.gpt5',
        messageCount: 1
      });
      expect(await readFile(join(dir, files[0] ?? ''), 'utf8')).not.toContain('local-secret-token');
      expect(await readFile(join(dir, files[0] ?? ''), 'utf8')).not.toContain('sk-supersecret0000');
      expect(JSON.stringify(records)).not.toContain('hello from owner');
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test('truncates oversized payloads and rotates old debug files', async () => {
    const home = await createTempLinnsyHome();
    const observer = createFileLlmRequestDebugObserver({
      enabled: true,
      home,
      maxFileBytes: 260,
      maxFiles: 2,
      maxRecordsPerRun: 6
    });

    try {
      const scope = { runId: 'run_big', conversationId: 'conv_1', turnId: 'turn_1' };
      for (let index = 0; index < 4; index += 1) {
        await observer.observeWireRequest({
          scope,
          modelId: 'openai.gpt5',
          provider: 'openai',
          apiProtocol: 'openai_responses',
          stream: true,
          request: {
            model: 'gpt-5',
            input: [{ role: 'user', content: 'x'.repeat(600) }]
          }
        });
      }

      const dir = join(home, 'debug', 'llm-requests');
      const files = await readdir(dir);
      expect(files).toHaveLength(2);
      const combined = (await Promise.all(files.map((file) => readFile(join(dir, file), 'utf8')))).join('\n');
      expect(combined).toContain('"payloadTruncated":true');
      expect(combined).not.toContain('x'.repeat(600));
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
