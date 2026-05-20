import type { LoggerPort } from '../../../../shared/ports.js';
import { consoleLogger } from '../../../../shared/ports.js';

import type { AuthDecision, AuthorizationPort } from './types.js';

export interface CreateAuthGuardStubOptions {
  logger?: LoggerPort;
  /**
   * Optional override predicate; default: allow everything.
   * Phase 1 contract: real allowlist / pairing / global toggles land in S2.
   */
  decide?: (message: { platform: string; chatType: string; chatId: string }) => AuthDecision;
}

export function createAuthGuardStub(options: CreateAuthGuardStubOptions = {}): AuthorizationPort {
  const logger = options.logger ?? consoleLogger;
  const decide = options.decide ?? defaultAllowAll;

  return {
    authorize(message): Promise<AuthDecision> {
      const decision = decide({
        platform: message.platform,
        chatType: message.chatType,
        chatId: message.chatId
      });
      if (!decision.allow) {
        logger.warn('auth-guard-stub denied inbound message', {
          platform: message.platform,
          chatType: message.chatType,
          chatId: message.chatId,
          reason: decision.reason
        });
      }
      return Promise.resolve(decision);
    }
  };
}

function defaultAllowAll(): AuthDecision {
  return { allow: true, layer: 'stub_phase1' };
}
