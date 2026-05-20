import type { InternalSubAgentRunner } from './types.js';
import {
  createExecutorRunner,
  type CreateInternalSubAgentExecutorRunnerOptions
} from './executor-runner.js';
import {
  createGraphRunner,
  type CreateInternalSubAgentGraphRunnerOptions
} from './graph-runner.js';

export type {
  CreateInternalSubAgentExecutorRunnerOptions
} from './executor-runner.js';
export type {
  CreateInternalSubAgentGraphRunnerOptions,
  InternalSubAgentRunSpawnerPort
} from './graph-runner.js';

export type CreateInternalSubAgentRunnerOptions =
  | CreateInternalSubAgentExecutorRunnerOptions
  | CreateInternalSubAgentGraphRunnerOptions;

export function createInternalSubAgentRunner(options: CreateInternalSubAgentRunnerOptions): InternalSubAgentRunner {
  if ('executor' in options) {
    return createExecutorRunner(options);
  }
  return createGraphRunner(options);
}
