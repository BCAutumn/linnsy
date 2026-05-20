import type { AgentDefinition } from './contracts.js';

import { createDelegateToCodexDefinition } from './delegate-to-codex/definition.js';
import { createLinnsyCronRunnerDefinition } from '../../../cron/features/cron-agent/definition.js';
import { createLinnsyEchoSubagentDefinition } from './linnsy-echo-subagent/definition.js';
import { createLinnsyGeneralSubagentDefinition } from './linnsy-general-subagent/definition.js';
import { createLinnsyMainAgentDefinition } from './linnsy-main/definition.js';

export {
  createDelegateToCodexDefinition,
  DELEGATE_TO_CODEX_AGENT_ID
} from './delegate-to-codex/definition.js';
export {
  createLinnsyMainAgentDefinition,
  LINNSY_MAIN_AGENT_ID
} from './linnsy-main/definition.js';
export {
  createLinnsyCronRunnerDefinition,
  LINNSY_CRON_RUNNER_ID
} from '../../../cron/features/cron-agent/definition.js';
export {
  createLinnsyEchoSubagentDefinition,
  LINNSY_ECHO_SUBAGENT_ID
} from './linnsy-echo-subagent/definition.js';
export {
  createLinnsyGeneralSubagentDefinition,
  LINNSY_GENERAL_SUBAGENT_ID
} from './linnsy-general-subagent/definition.js';
export {
  renderPromptTemplate,
  type PromptTemplateVariables
} from './prompt-template.js';
export type { BuiltInAgentModule } from './types.js';

export function createBuiltInAgentDefinitions(): AgentDefinition[] {
  return [
    createLinnsyMainAgentDefinition(),
    createLinnsyGeneralSubagentDefinition(),
    createLinnsyEchoSubagentDefinition(),
    createLinnsyCronRunnerDefinition(),
    createDelegateToCodexDefinition()
  ];
}
