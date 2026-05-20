import type { ToolRuntimePort } from '@linnlabs/linnkit/runtime-kernel';

import type { LinnsyPathManager } from '../../config/path-manager.js';
import { FileToolResultStore } from '../../persistence/stores/file-tool-result/file-tool-result-store.js';
import type { ExternalAgentDispatcherPort } from '../../domains/task/features/external-dispatch/types.js';
import type { CodexSessionBridgePort } from '../../domains/task/features/external-dispatch/codex/codex-session-bridge.js';
import type { InternalSubAgentRunner } from '../../domains/agent-run/features/internal-subagent/types.js';
import type { LinnsyNotificationLayer } from '../../domains/conversation/features/notification/types.js';
import { createDelegateToExternalTool } from '../../domains/agent-run/features/tool-runtime/tools/delegate-to-external.js';
import { createDelegateToInternalTool } from '../../domains/agent-run/features/tool-runtime/tools/delegate-to-internal.js';
import { createGetTaskStatusTool } from '../../domains/agent-run/features/tool-runtime/tools/get-task-status.js';
import { createListTasksTool } from '../../domains/agent-run/features/tool-runtime/tools/list-tasks.js';
import { createManageExternalSessionTool } from '../../domains/agent-run/features/tool-runtime/tools/manage-external-session.js';
import { createManageMemoryTool } from '../../domains/agent-run/features/tool-runtime/tools/manage-memory.js';
import { createManageScheduleTool } from '../../domains/agent-run/features/tool-runtime/tools/manage-schedule.js';
import { createRedelegateTaskTool } from '../../domains/agent-run/features/tool-runtime/tools/redelegate-task.js';
import { createManageTaskTool } from '../../domains/agent-run/features/tool-runtime/tools/manage-task.js';
import { createToolResultGuard } from '../../domains/agent-run/features/tool-runtime/tool-result-guard.js';
import { createLinnsyToolRuntime } from '../../domains/agent-run/features/tool-runtime/tool-runtime.js';
import type { WorkspacePort } from '../../domains/task/features/workspace/definitions/types.js';
import type { RuntimeEventHubPort } from '../../domains/observability/features/event-hub/event-hub.js';
import type { LinnsyAgentRegistryPort } from '../../domains/agent-run/features/agents/registry/types.js';
import type { LinnsyRuntimeFoundation } from './foundation.js';

export interface CreateProductionToolRuntimeOptions {
  foundation: LinnsyRuntimeFoundation;
  registry: LinnsyAgentRegistryPort;
  workspace: WorkspacePort;
  dispatcher: ExternalAgentDispatcherPort;
  codexSessionBridge: CodexSessionBridgePort;
  internalRunner: InternalSubAgentRunner;
  notificationLayer: LinnsyNotificationLayer;
  pathManager: LinnsyPathManager;
  events: RuntimeEventHubPort;
}

export function createProductionToolRuntime(
  options: CreateProductionToolRuntimeOptions
): ToolRuntimePort {
  return createLinnsyToolRuntime({
    events: options.events,
    resultGuard: createToolResultGuard({
      store: new FileToolResultStore()
    }),
    tools: [
      createDelegateToExternalTool({
        registry: options.registry,
        taskTracker: options.foundation.taskTracker,
        workspace: options.workspace,
        dispatcher: options.dispatcher,
        pathManager: options.pathManager
      }),
      createDelegateToInternalTool({
        registry: options.registry,
        taskTracker: options.foundation.taskTracker,
        workspace: options.workspace,
        runner: options.internalRunner
      }),
      createManageExternalSessionTool({
        registry: options.registry,
        taskTracker: options.foundation.taskTracker,
        workspace: options.workspace,
        codexSessionBridge: options.codexSessionBridge
      }),
      createListTasksTool({ taskTracker: options.foundation.taskTracker }),
      createGetTaskStatusTool({ taskTracker: options.foundation.taskTracker }),
      createManageTaskTool({ taskTracker: options.foundation.taskTracker, dispatcher: options.dispatcher }),
      createRedelegateTaskTool({
        registry: options.registry,
        taskTracker: options.foundation.taskTracker,
        workspace: options.workspace,
        dispatcher: options.dispatcher,
        internalRunner: options.internalRunner,
        notification: options.notificationLayer
      }),
      createManageScheduleTool({ cronStore: options.foundation.cronStore }),
      createManageMemoryTool({
        memoryStore: options.foundation.memoryStore,
        now: () => options.foundation.clock.now()
      })
    ]
  });
}
