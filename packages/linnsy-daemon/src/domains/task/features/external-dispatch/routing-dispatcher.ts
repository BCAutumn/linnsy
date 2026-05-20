import { LINNSY_ERROR_CODES, LinnsyError } from '../../../../shared/errors.js';
import type { TaskTrackerPort } from '../../ports/task-tracker-port.js';

import type {
  ExternalAgentCancelInput,
  ExternalAgentContinueInput,
  ExternalAgentDispatcherPort,
  ExternalAgentDispatchInput
} from './types.js';

export interface CreateRoutingExternalAgentDispatcherOptions {
  taskTracker: TaskTrackerPort;
  routes: Record<string, ExternalAgentDispatcherPort>;
}

export function createRoutingExternalAgentDispatcher(
  options: CreateRoutingExternalAgentDispatcherOptions
): ExternalAgentDispatcherPort {
  return {
    async dispatch(input: ExternalAgentDispatchInput): Promise<void> {
      await readRoute(options.routes, input.definitionKey).dispatch(input);
    },

    async continue(input: ExternalAgentContinueInput): Promise<void> {
      const definitionKey = await readTaskDefinitionKey(options.taskTracker, input.taskId);
      await readRoute(options.routes, definitionKey).continue(input);
    },

    async cancel(input: ExternalAgentCancelInput): Promise<void> {
      const definitionKey = await readTaskDefinitionKey(options.taskTracker, input.taskId);
      await readRoute(options.routes, definitionKey).cancel(input);
    }
  };
}

function readRoute(
  routes: Record<string, ExternalAgentDispatcherPort>,
  definitionKey: string
): ExternalAgentDispatcherPort {
  const route = routes[definitionKey];
  if (route === undefined) {
    throw new LinnsyError(
      LINNSY_ERROR_CODES.EXTERNAL_VENDOR_NOT_AVAILABLE,
      `external dispatcher for ${definitionKey} is not available`,
      false
    );
  }
  return route;
}

async function readTaskDefinitionKey(taskTracker: TaskTrackerPort, taskId: string): Promise<string> {
  const task = await taskTracker.get(taskId);
  const definitionKey = task?.payload?.definitionKey;
  if (typeof definitionKey !== 'string' || definitionKey.trim().length === 0) {
    throw new LinnsyError(
      LINNSY_ERROR_CODES.EXTERNAL_VENDOR_NOT_AVAILABLE,
      `external task ${taskId} has no routable definitionKey`,
      false
    );
  }
  return definitionKey;
}
