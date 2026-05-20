import { z } from 'zod';

import { isRuntimeEventKind, type RuntimeEventEnvelope } from '../../domains/observability/definitions/runtime-events.js';

export type { RuntimeEventEnvelope, RuntimeEventKind } from '../../domains/observability/definitions/runtime-events.js';

export const runtimeEventEnvelopeSchema = z.custom<RuntimeEventEnvelope>((value) => {
  if (!isRecord(value)) return false;
  return typeof value.eventId === 'string'
    && typeof value.seq === 'number'
    && isRuntimeEventKind(value.kind)
    && typeof value.createdAt === 'number'
    && isRecord(value.payload)
    && (value.conversationId === undefined || typeof value.conversationId === 'string')
    && (value.messageId === undefined || typeof value.messageId === 'string')
    && (value.runId === undefined || typeof value.runId === 'string');
}, {
  message: 'invalid runtime event envelope'
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
