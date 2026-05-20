import { readdir, readFile, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { describe, expect, test } from 'vitest';

import { createAssistantMessage, createUserMessage, type AuditEnvelope } from '@linnlabs/linnkit/contracts';

import { createTempLinnsyHome } from '../../../../../../__tests__/harness/temp-home.js';
import { minimalConfig } from '../../../../agent-run/features/run-executor/__tests__/scenarios/linnkit-graph-executor-support.js';
import { createLinnsyAuditManager } from '../linnsy-audit.js';

describe('linnsy audit manager', () => {
  test('rotates and prunes decision audit logs using the configured retention policy', async () => {
    const home = await createTempLinnsyHome();
    const manager = createLinnsyAuditManager({
      config: {
        ...minimalConfig(home),
        observability: {
          audit: {
            cleanup_interval_ms: 60_000,
            retention_ms: 30 * 24 * 60 * 60 * 1000,
            decision_max_file_bytes: 1,
            decision_max_files: 2,
            run_context_enabled: false
          }
        }
      }
    });

    try {
      await manager.decisionAuditPort.emit(createEnvelope('run_a'));
      await manager.decisionAuditPort.emit(createEnvelope('run_b'));
      await manager.decisionAuditPort.emit(createEnvelope('run_c'));
      await manager.cleanupNow();

      const entries = (await readdir(dirname(manager.decisionLogPath)))
        .filter((entry) => entry.startsWith('decisions') && entry.endsWith('.jsonl'));
      expect(entries).toHaveLength(2);
    } finally {
      manager.dispose();
      await rm(home, { recursive: true, force: true });
    }
  });

  test('writes run context snapshots with message hash de-duplication', async () => {
    const home = await createTempLinnsyHome();
    const manager = createLinnsyAuditManager({
      config: {
        ...minimalConfig(home),
        observability: {
          audit: {
            cleanup_interval_ms: 60_000,
            run_context_enabled: true
          }
        }
      }
    });

    try {
      const repeatedMessage = createUserMessage('context_injection', 'hello');
      await manager.runContextAudit.recordRunContext({
        runId: 'run_context',
        conversationId: 'conv_context',
        turnId: 'turn_context',
        query: 'hello',
        status: 'completed',
        contextFenceCount: 0,
        startedAt: 1,
        completedAt: 2,
        snapshots: [
          {
            sequence: 1,
            modelId: 'openai.gpt5',
            messageCount: 2,
            messages: [repeatedMessage, repeatedMessage]
          }
        ]
      });

      const [line] = (await readFile(manager.runContextLogPath, 'utf8')).trim().split('\n');
      const record = parseJsonObject(line);
      expect(record).toMatchObject({
        kind: 'run_context',
        runId: 'run_context',
        uniqueMessageCount: 1,
        snapshotCount: 1
      });
      expect(readArrayLength(record, 'uniqueMessages')).toBe(1);
      expect(readArrayLength(readFirstSnapshot(record), 'messageRefs')).toBe(2);
    } finally {
      manager.dispose();
      await rm(home, { recursive: true, force: true });
    }
  });

  test('removes thought messages and reasoning sidecars from run context audit records', async () => {
    const home = await createTempLinnsyHome();
    const manager = createLinnsyAuditManager({
      config: {
        ...minimalConfig(home),
        observability: {
          audit: {
            cleanup_interval_ms: 60_000,
            run_context_enabled: true
          }
        }
      }
    });

    try {
      const toolCallMessage = createAssistantMessage('tool_calls', '', {
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'list_tasks', arguments: '{}' }
          }
        ],
        reasoning_details: [{ provider: 'deepseek', type: 'reasoning_content', reasoning_content: 'private chain' }]
      });
      await manager.runContextAudit.recordRunContext({
        runId: 'run_private',
        conversationId: 'conv_private',
        turnId: 'turn_private',
        query: '查任务',
        status: 'completed',
        contextFenceCount: 0,
        startedAt: 1,
        completedAt: 2,
        snapshots: [
          {
            sequence: 1,
            modelId: 'deepseek.reasoner',
            messageCount: 2,
            messages: [
              createAssistantMessage('thought', 'should not be audited'),
              toolCallMessage
            ]
          }
        ]
      });

      const [line] = (await readFile(manager.runContextLogPath, 'utf8')).trim().split('\n');
      const record = parseJsonObject(line);
      expect(record).toMatchObject({
        kind: 'run_context',
        uniqueMessageCount: 1
      });
      expect(readFirstSnapshot(record).messageCount).toBe(1);
      const [messageRecord] = readArray(record, 'uniqueMessages');
      expect(messageRecord).toMatchObject({
        message: {
          role: 'assistant',
          type: 'tool_calls'
        }
      });
      expect(readNestedMetadata(messageRecord)).not.toHaveProperty('reasoning_details');
    } finally {
      manager.dispose();
      await rm(home, { recursive: true, force: true });
    }
  });
});

function createEnvelope(runId: string): AuditEnvelope {
  return {
    envelopeId: `audit_${runId}`,
    runId,
    ts: Date.now(),
    actor: { kind: 'system' },
    action: 'run.cancel',
    decision: {
      outcome: 'cancelled',
      reason: 'test'
    },
    evidence: [
      {
        kind: 'cancel_request',
        summary: 'test'
      }
    ],
    scope: { runId }
  };
}

function parseJsonObject(value: string | undefined): Record<string, unknown> {
  if (value === undefined) {
    throw new Error('expected JSON line');
  }
  const parsed = JSON.parse(value) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('expected JSON object');
  }
  return parsed as Record<string, unknown>;
}

function readArrayLength(record: Record<string, unknown>, key: string): number {
  return readArray(record, key).length;
}

function readArray(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    throw new Error(`expected ${key} to be an array`);
  }
  return value;
}

function readFirstSnapshot(record: Record<string, unknown>): Record<string, unknown> {
  const snapshots = record.snapshots;
  if (!Array.isArray(snapshots) || snapshots.length === 0) {
    throw new Error('expected snapshots');
  }
  const first: unknown = snapshots[0];
  if (typeof first !== 'object' || first === null || Array.isArray(first)) {
    throw new Error('expected snapshot object');
  }
  return first as Record<string, unknown>;
}

function readNestedMetadata(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error('expected message record object');
  }
  const message = value.message;
  if (!isRecord(message)) {
    throw new Error('expected nested message object');
  }
  const metadata = message.metadata;
  if (!isRecord(metadata)) {
    throw new Error('expected nested metadata object');
  }
  return metadata;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
