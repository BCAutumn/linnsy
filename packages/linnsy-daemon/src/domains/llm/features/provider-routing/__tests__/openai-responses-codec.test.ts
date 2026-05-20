import {
  createAssistantMessage,
  createSystemMessage,
  createToolMessage,
  createUserMessage
} from '@linnlabs/linnkit/contracts';
import { describe, expect, test } from 'vitest';

import { buildOpenAiResponsesRequest } from '../codecs/openai-responses.js';
import { createLinnsyFenceRegistry, LINNSY_FENCE_KINDS } from '../../../../agent-run/features/context-engineering/fences.js';
import type { LinnsyModelConfig } from '../../model-registry/model-registry.js';

describe('buildOpenAiResponsesRequest', () => {
  test('maps messages and reasoning options without leaking internal retry fields', () => {
    const request = buildOpenAiResponsesRequest(model(), [createUserMessage('user_input', 'think')], {
      max_tokens: 512,
      retry_policy: 'none',
      cloud_quota_fallback_model_id: 'fallback',
      signal: AbortSignal.timeout(1000)
    });

    expect(request).toEqual({
      model: 'gpt-5',
      input: [{ role: 'user', content: 'think' }],
      max_output_tokens: 512
    });
  });

  test('maps all message roles and supported provider options', () => {
    const request = buildOpenAiResponsesRequest(model(), [
      createSystemMessage('system_prompt', 'stay brief'),
      createUserMessage('user_input', 'remember me'),
      createAssistantMessage('final_answer', 'ok'),
      createToolMessage('memory saved', 'call_memory_1', 'save_memory')
    ], {
      temperature: 0.2,
      top_p: 0.9,
      tools: [
        {
          type: 'function',
          function: {
            name: 'save_memory',
            parameters: { type: 'object', properties: {} }
          }
        }
      ],
      tool_choice: 'auto'
    });

    expect(request).toEqual({
      model: 'gpt-5',
      input: [
        { role: 'system', content: 'stay brief' },
        { role: 'user', content: 'remember me' },
        { role: 'assistant', content: 'ok' },
        { role: 'tool', content: 'memory saved' }
      ],
      temperature: 0.2,
      top_p: 0.9,
      tools: [
        {
          type: 'function',
          function: {
            name: 'save_memory',
            parameters: { type: 'object', properties: {} }
          }
        }
      ],
      tool_choice: 'auto'
    });
  });

  test('formats Linnsy context_injection fences before building provider input', () => {
    const request = buildOpenAiResponsesRequest(model(), [
      createUserMessage('context_injection', 'child finished', {
        fenceKind: LINNSY_FENCE_KINDS.subagentSummary,
        fenceAttrs: { taskId: 'task_1' }
      }),
      createUserMessage('user_input', 'continue')
    ], {}, { fenceRegistry: createLinnsyFenceRegistry() });

    expect(request.input).toEqual([
      {
        role: 'user',
        content: '<subagent-summary taskId="task_1">\nchild finished\n</subagent-summary>'
      },
      { role: 'user', content: 'continue' }
    ]);
  });

  test('attaches reasoning effort and provider summary when model declares reasoning support', () => {
    const request = buildOpenAiResponsesRequest(
      {
        ...model(),
        capabilities: { supportsReasoning: true },
        reasoning: { effort: 'high' },
        providerOptions: { openai: { reasoningSummary: 'concise', textVerbosity: 'low' } }
      },
      [createUserMessage('user_input', 'think')]
    );

    expect(request.reasoning).toEqual({ effort: 'high', summary: 'concise' });
    expect(request.text).toEqual({ verbosity: 'low' });
  });

  test('omits reasoning when capabilities.supportsReasoning is false', () => {
    const request = buildOpenAiResponsesRequest(
      {
        ...model(),
        capabilities: { supportsReasoning: false },
        reasoning: { effort: 'high' },
        providerOptions: { openai: { reasoningSummary: 'concise' } }
      },
      [createUserMessage('user_input', 'think')]
    );

    expect(request.reasoning).toBeUndefined();
  });

  test('uses model.requestDefaults when caller omits sampling options', () => {
    const request = buildOpenAiResponsesRequest(
      {
        ...model(),
        requestDefaults: { temperature: 0.4, topP: 0.8, maxTokens: 256 }
      },
      [createUserMessage('user_input', 'hi')]
    );

    expect(request).toMatchObject({
      max_output_tokens: 256,
      temperature: 0.4,
      top_p: 0.8
    });
  });
});

function model(): LinnsyModelConfig {
  return {
    id: 'openai.gpt5',
    provider: 'openai',
    modelName: 'gpt-5',
    apiProtocol: 'openai_responses',
    apiKeyEnv: 'LINNSY_OPENAI_KEY'
  };
}
