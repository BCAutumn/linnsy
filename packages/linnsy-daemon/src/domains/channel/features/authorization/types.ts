import type { LinnsyMessage, Platform } from '../../../../shared/messaging.js';

export type { PairingStorePort } from '../../../../persistence/stores/pairing/pairing-store-port.js';

export type AuthDecision =
  | { allow: true; layer: 'platform_all' | 'allowlist' | 'pairing' | 'global_all' | 'stub_phase1' }
  | { allow: false; reason: string };

export interface AuthorizationPort {
  authorize(message: LinnsyMessage): Promise<AuthDecision>;
  generatePairingCode?(opts: PairingGenerationOptions): Promise<PairingGenerationResult>;
  consumePairingCode?(code: string, message: LinnsyMessage): Promise<AuthDecision>;
}

export interface PlatformAuthPolicy {
  allowAll: boolean;
  allowlist: readonly string[];
}

export interface PairingGenerationOptions {
  platform?: Platform;
  chatId?: string;
  userId?: string;
  ttlMs?: number;
}

export interface PairingGenerationResult {
  code: string;
  expiresAt: number;
}
