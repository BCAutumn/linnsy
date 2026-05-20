import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { AiMessage } from '@linnlabs/linnkit/contracts';
import type { AgentAiEngineStreamContent } from '@linnlabs/linnkit/ports';
import type {
  OpenAIToolSchema,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolRuntimeDefinition,
  ToolRuntimePort
} from '@linnlabs/linnkit/runtime-kernel';
import { createTempLinnsyHome } from '../../../../../../../__tests__/harness/temp-home.js';
import type { LinnsyConfig } from '../../../../../../config/schema.js';
import { createLinnsySystemEventFence } from '../../../context-engineering/fences.js';
import type {
  LinnsyLlmProvider,
  LinnsyProviderRouter
} from '../../../../../llm/features/provider-routing/provider-router.js';
import { createLinnsyMainAgentDefinition } from '../../../agents/index.js';
import { createLinnsyAgentRegistry } from '../../../agents/registry/registry.js';
import type {
  ExternalAgentDispatcherPort,
  ExternalAgentDispatchInput
} from '../../../../../task/features/external-dispatch/types.js';
import { createSystemPromptAssembler } from '../../../system-prompt/system-prompt-assembler.js';
import { createLinnsyRuntimeFoundation } from '../../../../../../app/bootstrap/foundation.js';
import { createLinnsyToolRuntime } from '../../../tool-runtime/tool-runtime.js';
import { toJsonObjectSchema } from '../../../tool-runtime/types.js';
import { createDelegateToExternalTool } from '../../../tool-runtime/tools/delegate-to-external.js';
import { createWorkspaceManager } from '../../../../../task/features/workspace/workspace-manager.js';
import { createLinnkitGraphRunExecutor } from '../../linnkit-graph-executor.js';


export function createReplyRouter(reply: string, capturedMessages?: AiMessage[][]): LinnsyProviderRouter {
  const provider: LinnsyLlmProvider = {
    complete(request) {
      capturedMessages?.push([...request.messages]);
      return Promise.resolve(reply);
    },
    stream(request, callbacks) {
      capturedMessages?.push([...request.messages]);
      callbacks.onContent?.(reply satisfies AgentAiEngineStreamContent);
      callbacks.onFinish?.('stop');
      return Promise.resolve();
    }
  };

  return {
    resolve() {
      return provider;
    }
  };
}

export function createToolThenAnswerRouter(capturedMessages: AiMessage[][]): LinnsyProviderRouter {
  let callCount = 0;
  const provider: LinnsyLlmProvider = {
    complete() {
      return Promise.resolve('unused');
    },
    stream(request, callbacks) {
      capturedMessages.push([...request.messages]);
      callCount += 1;
      if (callCount === 1) {
        callbacks.onContent?.({
          tool_calls: [
            {
              index: 0,
              id: 'call_list_tasks',
              function: {
                name: 'list_tasks',
                arguments: '{}'
              }
            }
          ]
        } satisfies AgentAiEngineStreamContent);
      } else {
        callbacks.onContent?.('saw tool result' satisfies AgentAiEngineStreamContent);
      }
      callbacks.onFinish?.('stop');
      return Promise.resolve();
    }
  };

  return {
    resolve() {
      return provider;
    }
  };
}

export function createCodexDelegationThenAnswerRouter(input: {
  capturedMessages: AiMessage[][];
  cwd: string;
  prompt: string;
}): LinnsyProviderRouter {
  let callCount = 0;
  const provider: LinnsyLlmProvider = {
    complete() {
      return Promise.resolve('unused');
    },
    stream(request, callbacks) {
      input.capturedMessages.push([...request.messages]);
      callCount += 1;
      if (callCount === 1) {
        callbacks.onContent?.({
          tool_calls: [
            {
              index: 0,
              id: 'call_delegate_codex',
              function: {
                name: 'delegate_to_external',
                arguments: JSON.stringify({
                  definitionKey: 'delegate_to_codex',
                  title: 'Codex smoke task',
                  locator: {
                    kind: 'directory',
                    label: 'project-under-test',
                    ref: input.cwd
                  },
                  payload: {
                    prompt: input.prompt
                  }
                })
              }
            }
          ]
        } satisfies AgentAiEngineStreamContent);
      } else {
        callbacks.onContent?.('Codex task dispatched.' satisfies AgentAiEngineStreamContent);
      }
      callbacks.onFinish?.('stop');
      return Promise.resolve();
    }
  };

  return {
    resolve() {
      return provider;
    }
  };
}

export function createSingleToolRuntime(): ToolRuntimePort {
  const definition: ToolRuntimeDefinition = {
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {}
    }
  };

  return {
    getToolSchemas(): OpenAIToolSchema[] {
      return [
        {
          type: 'function',
          function: {
            name: 'list_tasks',
            description: 'List tasks',
            parameters: toJsonObjectSchema(definition.parameters)
          }
        }
      ];
    },
    getToolDefinition(toolName: string): ToolRuntimeDefinition | undefined {
      return toolName === 'list_tasks' ? definition : undefined;
    },
    getDisplayOptions() {
      return undefined;
    },
    executeTool(
      toolName: string,
      args: Record<string, unknown>,
      context: ToolExecutionContext
    ): Promise<ToolExecutionResult> {
      void args;
      void context;
      if (toolName !== 'list_tasks') {
        return Promise.resolve({
          success: false,
          error: `unexpected tool ${toolName}`,
          errorKind: 'protocol',
          durationMs: 0
        });
      }
      return Promise.resolve({
        success: true,
        result: JSON.stringify({ tasks: [{ taskId: 'task_alpha', title: 'Alpha' }] }),
        durationMs: 0
      });
    }
  };
}

export function minimalConfig(home: string): LinnsyConfig {
  return {
    profile: 'test',
    home,
    llm: {
      default_provider: 'openai',
      defaults: {
        secretary: 'openai.gpt5',
        cron_summary: 'openai.gpt5',
        memory_consolidate: 'openai.gpt5'
      },
      providers: {
        openai: {
          api_protocol: 'openai_responses',
          api_key_env: 'LINNSY_OPENAI_KEY',
          models: {
            gpt5: {
              model_name: 'gpt-5'
            }
          }
        }
      }
    },
    channels: {
      cli: { enabled: true },
      web: { enabled: false, bind: '127.0.0.1:7700', bearer_env: 'LINNSY_WEB_BEARER' }
    },
    auth: {
      global_all: false,
      pairing: { code_ttl_ms: 600000, max_attempts: 5 }
    },
    cron: { tick_interval_ms: 60000, default_miss_grace_ms: 7200000 },
    memory: { on_pre_compress_provider: 'builtin' },
    mcp: { server: { enabled: true, transport: 'stdio' }, clients: [] }
  };
}

export { mkdir, rm, join, createTempLinnsyHome, createLinnsySystemEventFence, createLinnsyMainAgentDefinition, createLinnsyAgentRegistry, createSystemPromptAssembler, createLinnsyRuntimeFoundation, createLinnsyToolRuntime, createDelegateToExternalTool, createWorkspaceManager, createLinnkitGraphRunExecutor };
export type { AiMessage, ExternalAgentDispatcherPort, ExternalAgentDispatchInput };
