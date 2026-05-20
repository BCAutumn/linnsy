import { randomInt } from 'node:crypto';

import type { LoggerPort, ClockPort } from '../../../../shared/ports.js';
import { consoleLogger, systemClock } from '../../../../shared/ports.js';
import type { LinnsyMessage, Platform } from '../../../../shared/messaging.js';

import type {
  AuthDecision,
  AuthorizationPort,
  PairingStorePort,
  PlatformAuthPolicy
} from './types.js';

export interface CreateAuthorizationGuardOptions {
  globalAllowAll: boolean;
  platformPolicies: Partial<Record<Platform, PlatformAuthPolicy>>;
  pairingStore: PairingStorePort;
  clock?: ClockPort;
  logger?: LoggerPort;
  pairingCodeTtlMs?: number;
  pairingMaxAttempts?: number;
  codeFactory?: () => string;
}

export function createAuthorizationGuard(options: CreateAuthorizationGuardOptions): AuthorizationPort {
  const logger = options.logger ?? consoleLogger;
  const clock = options.clock ?? systemClock;
  const codeFactory = options.codeFactory ?? createDefaultPairingCode;
  const pairingCodeTtlMs = options.pairingCodeTtlMs ?? 600000;
  const pairingMaxAttempts = options.pairingMaxAttempts ?? 5;

  return {
    async authorize(message: LinnsyMessage): Promise<AuthDecision> {
      const policy = options.platformPolicies[message.platform];
      if (policy !== undefined && policy.allowAll) {
        return { allow: true, layer: 'platform_all' };
      }
      if (policy !== undefined && policy.allowlist.includes(message.chatId)) {
        return { allow: true, layer: 'allowlist' };
      }
      const paired = await options.pairingStore.hasAuthorizedPairing({
        platform: message.platform,
        chatId: message.chatId,
        ...(message.userId === undefined ? {} : { userId: message.userId })
      });
      if (paired) {
        return { allow: true, layer: 'pairing' };
      }
      if (options.globalAllowAll) {
        return { allow: true, layer: 'global_all' };
      }

      const decision: AuthDecision = { allow: false, reason: 'default_deny' };
      logger.info('authorization denied', {
        kind: 'LINNSY_AUTH_DENIED',
        platform: message.platform,
        chatType: message.chatType,
        chatId: message.chatId,
        reason: decision.reason
      });
      return decision;
    },

    async generatePairingCode(opts): Promise<{ code: string; expiresAt: number }> {
      const now = clock.now();
      const code = codeFactory();
      const expiresAt = now + (opts.ttlMs ?? pairingCodeTtlMs);
      await options.pairingStore.createPairing({
        platform: opts.platform ?? '*',
        chatId: opts.chatId ?? '*',
        ...(opts.userId === undefined ? {} : { userId: opts.userId }),
        code,
        expiresAt,
        createdAt: now
      });
      return { code, expiresAt };
    },

    async consumePairingCode(code: string, message: LinnsyMessage): Promise<AuthDecision> {
      const consumed = await options.pairingStore.consumePairingCode({
        code,
        platform: message.platform,
        chatId: message.chatId,
        ...(message.userId === undefined ? {} : { userId: message.userId }),
        now: clock.now(),
        maxAttempts: pairingMaxAttempts
      });
      return consumed ? { allow: true, layer: 'pairing' } : { allow: false, reason: 'pairing_invalid' };
    }
  };
}

const PAIRING_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function createDefaultPairingCode(): string {
  let code = '';
  for (let index = 0; index < 8; index += 1) {
    code += PAIRING_ALPHABET.charAt(randomInt(PAIRING_ALPHABET.length));
  }
  return code;
}
