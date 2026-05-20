import { isRecord } from '../../../../../shared/json.js';
import { buildOpenAiResponsesRequest } from '../codecs/openai-responses.js';
import type {
  LinnsyLlmProvider,
  LinnsyLlmProviderRequest,
  LinnsyProviderFactoryConfig,
  LinnsyStreamCallbacks
} from '../provider-router.js';
import { appendStreamUsage, appendUsage, runProviderOperation } from './shared.js';
import type { OpenAiClientPort, SdkProviderAdapter, SdkProviderAdapterDependencies } from './types.js';

export class OpenAiResponsesAdapter implements SdkProviderAdapter {
  public createProvider(
    config: LinnsyProviderFactoryConfig,
    dependencies: SdkProviderAdapterDependencies
  ): LinnsyLlmProvider {
    return new OpenAiResponsesProvider(dependencies.openAiClientFactory(config), dependencies);
  }
}

class OpenAiResponsesProvider implements LinnsyLlmProvider {
  public constructor(
    private readonly client: OpenAiClientPort,
    private readonly dependencies: Pick<SdkProviderAdapterDependencies, 'fenceRegistry'>
  ) {}

  public async complete(request: LinnsyLlmProviderRequest): Promise<unknown> {
    return runProviderOperation(request, async (signal) => {
      const response = await this.client.createResponse(
        buildOpenAiResponsesRequest(request.model, request.messages, request.options, {
          fenceRegistry: this.dependencies.fenceRegistry
        }),
        signal
      );
      return normalizeOpenAiResponsesResponse(response);
    });
  }

  public async stream(request: LinnsyLlmProviderRequest, callbacks: LinnsyStreamCallbacks): Promise<void> {
    await runProviderOperation(request, async (signal) => {
      const stream = this.client.streamResponse(
        buildOpenAiResponsesRequest(request.model, request.messages, request.options, {
          fenceRegistry: this.dependencies.fenceRegistry
        }),
        signal
      );

      for await (const event of stream) {
        emitOpenAiResponsesStreamEvent(event, callbacks);
      }
    });
  }
}

function normalizeOpenAiResponsesResponse(response: unknown): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  if (isRecord(response) && typeof response.output_text === 'string') {
    result.content = response.output_text;
  }
  appendUsage(result, response);
  return result;
}

function emitOpenAiResponsesStreamEvent(event: unknown, callbacks: LinnsyStreamCallbacks): void {
  if (!isRecord(event)) {
    return;
  }

  if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
    callbacks.onContent?.(event.delta);
  } else if (event.type === 'response.reasoning_text.delta' && typeof event.delta === 'string') {
    callbacks.onThought?.(event.delta);
  } else if (event.type === 'response.completed') {
    callbacks.onFinish?.('stop');
    appendStreamUsage(event.response, callbacks);
  }
}
