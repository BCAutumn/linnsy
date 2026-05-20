import type { AgentAiEngine, AgentAiEngineStreamContent, LlmCallOptions } from '@linnlabs/linnkit/ports';
import type { AiMessage } from '@linnlabs/linnkit/contracts';

import { LINNSY_ERROR_CODES, LinnsyError } from '../../shared/errors.js';
import type { LoggerPort } from '../../shared/ports.js';
import { silentLogger } from '../../shared/ports.js';
import type { LinnsyModelRegistryPort } from '../../domains/llm/features/model-registry/model-registry.js';
import {
  createProviderRouter,
  type LinnsyProviderRouter
} from '../../domains/llm/features/provider-routing/provider-router.js';
import type { LlmRequestDebugObserverPort } from '../../domains/llm/shared/llm-request-debug-observer.js';
import { readLlmRequestDebugScope } from '../../domains/llm/shared/llm-request-debug-scope.js';
import { getDefaultLinnsyFenceRegistry } from '../../domains/agent-run/features/context-engineering/fences.js';

export interface CreateLinnsyAiEngineBridgeOptions {
  registry: LinnsyModelRegistryPort;
  router?: LinnsyProviderRouter;
  llmRequestDebugObserver?: LlmRequestDebugObserverPort;
  logger?: LoggerPort;
}

const LLM_RETRY_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000] as const;
const MAX_LLM_RETRY_ELAPSED_MS = 30_000;

export function createLinnsyAiEngineBridge(options: CreateLinnsyAiEngineBridgeOptions): AgentAiEngine {
  const router = options.router ?? createProviderRouter({
    fenceRegistry: getDefaultLinnsyFenceRegistry()
  });
  const logger = options.logger ?? silentLogger;

  return {
    async chatCompletion(
      modelId: string,
      messages: AiMessage[],
      callOptions?: LlmCallOptions & { signal?: AbortSignal }
    ): Promise<unknown> {
      const model = readModel(options.registry, modelId);
      const debugScope = readLlmRequestDebugScope();
      await options.llmRequestDebugObserver?.observeCanonical({
        ...(debugScope === undefined ? {} : { scope: debugScope }),
        modelId,
        messages
      });
      const request = {
        model,
        messages
      };

      return completeWithFallback(options.registry, router, logger, request, callOptions);
    },

    async chatCompletionStream(
      modelId: string,
      messages: AiMessage[],
      callOptions?: LlmCallOptions & {
        signal?: AbortSignal;
        stream_options?: {
          include_usage?: boolean;
        };
      },
      onContent?: (content: AgentAiEngineStreamContent) => void,
      onError?: (error: Error) => void,
      onFinish?: (reason: string) => void,
      onThought?: (thought: string) => void,
      onUsage?: (usage: unknown) => void
    ): Promise<void> {
      const model = readModel(options.registry, modelId);
      const debugScope = readLlmRequestDebugScope();
      await options.llmRequestDebugObserver?.observeCanonical({
        ...(debugScope === undefined ? {} : { scope: debugScope }),
        modelId,
        messages
      });
      const request = {
        model,
        messages
      };
      const callbacks = createStreamCallbacks(onContent, onError, onFinish, onThought, onUsage);

      return streamWithFallback(options.registry, router, logger, request, callbacks, callOptions);
    }
  };
}

async function completeWithFallback(
  registry: LinnsyModelRegistryPort,
  router: LinnsyProviderRouter,
  logger: LoggerPort,
  request: {
    model: ReturnType<typeof readModel>;
    messages: AiMessage[];
  },
  callOptions: (LlmCallOptions & { signal?: AbortSignal }) | undefined
): Promise<unknown> {
  const modelChain = resolveModelChain(registry, request.model);
  let lastError: unknown;

  for (const model of modelChain) {
    const outcome = await retryLlmCall({
      model,
      logger,
      signal: callOptions?.signal,
      operation: async () => {
        const modelRequest = {
          model,
          messages: request.messages
        };
        if (callOptions !== undefined) {
          return await router.resolve(model).complete({ ...modelRequest, options: callOptions });
        }

        return await router.resolve(model).complete(modelRequest);
      }
    });
    if (outcome.ok) {
      return outcome.value;
    }
    lastError = outcome.error;
  }

  throw toThrowableError(lastError);
}

function resolveModelChain(
  registry: LinnsyModelRegistryPort,
  model: ReturnType<typeof readModel>
): Array<ReturnType<typeof readModel>> {
  const models = [model];
  for (const fallbackModelId of model.fallbackChain ?? []) {
    models.push(readModel(registry, fallbackModelId));
  }

  return models;
}

async function streamWithFallback(
  registry: LinnsyModelRegistryPort,
  router: LinnsyProviderRouter,
  logger: LoggerPort,
  request: {
    model: ReturnType<typeof readModel>;
    messages: AiMessage[];
  },
  callbacks: ReturnType<typeof createStreamCallbacks>,
  callOptions: (LlmCallOptions & {
    signal?: AbortSignal;
    stream_options?: {
      include_usage?: boolean;
    };
  }) | undefined
): Promise<void> {
  const modelChain = resolveModelChain(registry, request.model);
  let lastError: unknown;

  for (const model of modelChain) {
    const outcome = await retryLlmCall({
      model,
      logger,
      signal: callOptions?.signal,
      operation: async () => {
        const modelRequest = {
          model,
          messages: request.messages
        };
        const tracked = createTrackedStreamCallbacks(callbacks);
        try {
          if (callOptions !== undefined) {
            await router.resolve(model).stream({ ...modelRequest, options: callOptions }, tracked.callbacks);
            return;
          }

          await router.resolve(model).stream(modelRequest, tracked.callbacks);
        } catch (error: unknown) {
          if (tracked.hasEmitted()) {
            logger.warn('llm stream failed after emitting output; retry skipped', {
              provider: model.provider,
              modelId: model.id,
              errorCode: readLinnsyErrorCode(error)
            });
            throw markStreamOutputAlreadyEmitted(error);
          }
          throw toThrowableError(error);
        }
      }
    });
    if (outcome.ok) {
      return;
    }
    lastError = outcome.error;
  }

  throw toThrowableError(lastError);
}

type RetryOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown };

async function retryLlmCall<T>(input: {
  model: ReturnType<typeof readModel>;
  logger: LoggerPort;
  signal: AbortSignal | undefined;
  operation(): Promise<T>;
}): Promise<RetryOutcome<T>> {
  const startedAt = Date.now();
  let attempt = 0;

  for (;;) {
    try {
      return { ok: true, value: await input.operation() };
    } catch (error: unknown) {
      if (input.signal?.aborted === true || isStreamOutputAlreadyEmitted(error) || !isRecoverableLlmError(error)) {
        throw toThrowableError(unwrapStreamOutputAlreadyEmitted(error));
      }

      const delayMs = LLM_RETRY_DELAYS_MS[attempt];
      if (delayMs === undefined || Date.now() - startedAt + delayMs > MAX_LLM_RETRY_ELAPSED_MS) {
        return { ok: false, error };
      }

      attempt += 1;
      input.logger.warn('llm provider call failed; retrying', {
        provider: input.model.provider,
        modelId: input.model.id,
        attempt,
        maxRetries: LLM_RETRY_DELAYS_MS.length,
        delayMs,
        errorCode: readLinnsyErrorCode(error)
      });
      await delay(delayMs);
    }
  }
}

function isRecoverableLlmError(error: unknown): boolean {
  return error instanceof LinnsyError && error.recoverable;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createStreamCallbacks(
  onContent?: (content: AgentAiEngineStreamContent) => void,
  onError?: (error: Error) => void,
  onFinish?: (reason: string) => void,
  onThought?: (thought: string) => void,
  onUsage?: (usage: unknown) => void
) {
  const callbacks: {
    onContent?: (content: AgentAiEngineStreamContent) => void;
    onError?: (error: Error) => void;
    onFinish?: (reason: string) => void;
    onThought?: (thought: string) => void;
    onUsage?: (usage: unknown) => void;
  } = {};

  if (onContent !== undefined) {
    callbacks.onContent = onContent;
  }
  if (onError !== undefined) {
    callbacks.onError = onError;
  }
  if (onFinish !== undefined) {
    callbacks.onFinish = onFinish;
  }
  if (onThought !== undefined) {
    callbacks.onThought = onThought;
  }
  if (onUsage !== undefined) {
    callbacks.onUsage = onUsage;
  }

  return callbacks;
}

function createTrackedStreamCallbacks(callbacks: ReturnType<typeof createStreamCallbacks>): {
  callbacks: ReturnType<typeof createStreamCallbacks>;
  hasEmitted(): boolean;
} {
  let emitted = false;

  return {
    callbacks: {
      onContent(content): void {
        emitted = true;
        callbacks.onContent?.(content);
      },
      onError(error): void {
        emitted = true;
        callbacks.onError?.(error);
      },
      onFinish(reason): void {
        emitted = true;
        callbacks.onFinish?.(reason);
      },
      onThought(thought): void {
        emitted = true;
        callbacks.onThought?.(thought);
      },
      onUsage(usage): void {
        emitted = true;
        callbacks.onUsage?.(usage);
      }
    },
    hasEmitted(): boolean {
      return emitted;
    }
  };
}

class StreamOutputAlreadyEmittedError extends Error {
  public readonly causeUnknown: unknown;

  public constructor(cause: unknown) {
    super('stream output already emitted');
    this.name = 'StreamOutputAlreadyEmittedError';
    this.causeUnknown = cause;
  }
}

function markStreamOutputAlreadyEmitted(error: unknown): StreamOutputAlreadyEmittedError {
  return new StreamOutputAlreadyEmittedError(error);
}

function isStreamOutputAlreadyEmitted(error: unknown): error is StreamOutputAlreadyEmittedError {
  return error instanceof StreamOutputAlreadyEmittedError;
}

function unwrapStreamOutputAlreadyEmitted(error: unknown): unknown {
  return isStreamOutputAlreadyEmitted(error) ? error.causeUnknown : error;
}

function readLinnsyErrorCode(error: unknown): string | undefined {
  if (error instanceof LinnsyError) {
    return error.code;
  }
  if (isStreamOutputAlreadyEmitted(error)) {
    return readLinnsyErrorCode(error.causeUnknown);
  }
  return undefined;
}

function toThrowableError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
}

function readModel(registry: LinnsyModelRegistryPort, modelId: string) {
  const model = registry.getModel(modelId);
  if (model !== null) {
    return model;
  }

  throw new LinnsyError(
    LINNSY_ERROR_CODES.LLM_MODEL_NOT_FOUND,
    `Model ${modelId} is not configured`,
    false
  );
}
