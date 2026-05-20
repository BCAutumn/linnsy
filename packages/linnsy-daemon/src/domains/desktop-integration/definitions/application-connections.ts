export type {
  ApplicationConnectionsSnapshot,
  CodexConnectionState,
  CodexConnectionStatus,
  UnsupportedApplicationConnectionState
} from '../../../shared/dto/application-connections.js';

import type {
  ApplicationConnectionsSnapshot,
  CodexConnectionState
} from '../../../shared/dto/application-connections.js';

export function createApplicationConnectionsSnapshot(input: {
  codex: CodexConnectionState;
}): ApplicationConnectionsSnapshot {
  return {
    codex: input.codex,
    claudeCode: { status: 'unsupported' },
    cursor: { status: 'unsupported' }
  };
}
