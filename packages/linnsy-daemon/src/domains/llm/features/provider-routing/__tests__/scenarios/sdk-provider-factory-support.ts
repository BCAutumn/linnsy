import { createUserMessage } from '@linnlabs/linnkit/contracts';
import { LINNSY_ERROR_CODES, LinnsyError } from '../../../../../../shared/errors.js';
import { createSdkProviderFactory, type AnthropicClientPort, type OpenAiClientPort } from '../../sdk-provider-factory.js';
import type { LinnsyModelConfig } from '../../../model-registry/model-registry.js';


export function model(apiProtocol: LinnsyModelConfig['apiProtocol']): LinnsyModelConfig {
  return {
    id: `openai.${apiProtocol}`,
    provider: 'openai',
    modelName: 'gpt-5',
    apiProtocol,
    apiKeyEnv: 'LINNSY_OPENAI_KEY'
  };
}

export async function* emptyStream(): AsyncIterable<unknown> {}

export async function* streamFrom(events: unknown[]): AsyncIterable<unknown> {
  for (const event of events) {
    await Promise.resolve();
    yield event;
  }
}

export { createUserMessage, LINNSY_ERROR_CODES, LinnsyError, createSdkProviderFactory };
export type { AnthropicClientPort, OpenAiClientPort, LinnsyModelConfig };
