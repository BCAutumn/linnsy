import type { ToolCallChunk } from '@linnlabs/linnkit/ports';

import { LINNSY_ERROR_CODES, LinnsyError } from '../../../../../shared/errors.js';
import { isRecord } from '../../../../../shared/json.js';
import type { LinnsyLlmProviderRequest, LinnsyStreamCallbacks } from '../provider-router.js';

const DEFAULT_LLM_TIMEOUT_MS = 120_000;

export async function runProviderOperation<T>(
  request: LinnsyLlmProviderRequest,
  operation: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const timeout = createLinkedAbortSignal(request.options?.signal, DEFAULT_LLM_TIMEOUT_MS);
  try {
    return await operation(timeout.signal);
  } catch (error: unknown) {
    throw normalizeProviderError(error, request.model.provider);
  } finally {
    timeout.dispose();
  }
}

export function invalidCodecPayload(message: string): LinnsyError {
  return new LinnsyError(LINNSY_ERROR_CODES.LLM_CODEC_INVALID_PAYLOAD, message, false);
}

export function firstChoice(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value) || !Array.isArray(value.choices)) {
    return undefined;
  }

  const choices: unknown[] = value.choices;
  const first = choices[0];
  return isRecord(first) ? first : undefined;
}

export function readToolCallChunks(value: unknown): ToolCallChunk[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const chunks: ToolCallChunk[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.index !== 'number' || !isRecord(item.function)) {
      continue;
    }
    const chunk: ToolCallChunk = {
      index: item.index
    };

    if (typeof item.id === 'string') {
      chunk.id = item.id;
    }
    if (typeof item.function.name === 'string' || typeof item.function.arguments === 'string') {
      chunk.function = {};
      if (typeof item.function.name === 'string') {
        chunk.function.name = item.function.name;
      }
      if (typeof item.function.arguments === 'string') {
        chunk.function.arguments = item.function.arguments;
      }
    }
    chunks.push(chunk);
  }

  return chunks;
}

export function appendUsage(result: Record<string, unknown>, response: unknown): void {
  if (isRecord(response) && response.usage !== undefined) {
    result.usage = response.usage;
  }
}

export function appendStreamUsage(event: unknown, callbacks: LinnsyStreamCallbacks): void {
  if (isRecord(event) && event.usage !== undefined) {
    callbacks.onUsage?.(event.usage);
  }
}

export async function* flattenStream(streamPromise: Promise<AsyncIterable<unknown>>): AsyncIterable<unknown> {
  const stream = await streamPromise;
  for await (const event of stream) {
    yield event;
  }
}

function createLinkedAbortSignal(parentSignal: AbortSignal | undefined, timeoutMs: number): {
  signal: AbortSignal;
  dispose(): void;
} {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new Error(`LLM request timed out after ${String(timeoutMs)}ms`));
  }, timeoutMs);

  const abortFromParent = (): void => {
    controller.abort(parentSignal?.reason);
  };
  if (parentSignal?.aborted === true) {
    abortFromParent();
  } else {
    parentSignal?.addEventListener('abort', abortFromParent, { once: true });
  }

  return {
    signal: controller.signal,
    dispose(): void {
      clearTimeout(timeoutId);
      parentSignal?.removeEventListener('abort', abortFromParent);
    }
  };
}

function normalizeProviderError(error: unknown, provider: string): LinnsyError {
  if (error instanceof LinnsyError) {
    return error;
  }

  const status = readHttpStatus(error);
  const message = error instanceof Error ? error.message : 'Unknown provider error';
  if (status === 401 || status === 403) {
    return new LinnsyError(
      LINNSY_ERROR_CODES.LLM_PROVIDER_AUTH_MISSING,
      `${provider} rejected the configured API credentials`,
      false
    );
  }

  if (status === 408 || status === 409 || status === 425 || status === 429 || (status !== undefined && status >= 500)) {
    return new LinnsyError(
      LINNSY_ERROR_CODES.LLM_PROVIDER_UNAVAILABLE,
      `${provider} provider is temporarily unavailable: ${message}`,
      true
    );
  }

  if (isAbortError(error) || isNetworkTransportError(error)) {
    return new LinnsyError(
      LINNSY_ERROR_CODES.LLM_PROVIDER_UNAVAILABLE,
      `${provider} provider request was aborted, timed out, or lost network connectivity`,
      true
    );
  }

  return new LinnsyError(
    LINNSY_ERROR_CODES.LLM_PROVIDER_REQUEST_FAILED,
    `${provider} provider request failed: ${message}`,
    false
  );
}

function readHttpStatus(error: unknown): number | undefined {
  if (!isRecord(error) || typeof error.status !== 'number') {
    return undefined;
  }

  return error.status;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function isNetworkTransportError(error: unknown): boolean {
  const name = error instanceof Error ? error.name : undefined;
  if (
    name === 'APIConnectionError'
    || name === 'APIConnectionTimeoutError'
    || name === 'TimeoutError'
  ) {
    return true;
  }

  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (
    message.includes('fetch failed')
    || message.includes('networkerror')
    || message.includes('network error')
    || message.includes('socket hang up')
  ) {
    return true;
  }

  const code = readErrorCode(error);
  return code === 'ECONNRESET'
    || code === 'ECONNREFUSED'
    || code === 'ENOTFOUND'
    || code === 'EAI_AGAIN'
    || code === 'ETIMEDOUT'
    || code === 'UND_ERR_CONNECT_TIMEOUT';
}

function readErrorCode(error: unknown): string | undefined {
  if (!isRecord(error)) {
    return undefined;
  }
  if (typeof error.code === 'string') {
    return error.code;
  }
  return readErrorCode(error.cause);
}
