import type { Platform } from '../../../shared/messaging.js';

export interface PairingStorePort {
  hasAuthorizedPairing(input: {
    platform: Platform;
    chatId: string;
    userId?: string;
  }): Promise<boolean>;
  createPairing(input: {
    platform: Platform;
    chatId: string;
    userId?: string;
    code: string;
    expiresAt: number;
    createdAt: number;
  }): Promise<void>;
  consumePairingCode(input: {
    code: string;
    platform: Platform;
    chatId: string;
    userId?: string;
    now: number;
    maxAttempts: number;
  }): Promise<boolean>;
}
