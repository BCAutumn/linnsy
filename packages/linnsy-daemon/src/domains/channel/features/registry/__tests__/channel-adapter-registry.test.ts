import { describe, expect, test } from 'vitest';

import { LINNSY_ERROR_CODES } from '../../../../../shared/errors.js';
import type { OutboundPayload, Platform, SendTarget } from '../../../../../shared/messaging.js';

import { createChannelAdapterRegistry } from '../channel-adapter-registry.js';
import type { ChannelAdapterPort, InboundHandler } from '../../../definitions/types.js';

describe('createChannelAdapterRegistry', () => {
  test('indexes adapters by platform and exposes a stable map view', () => {
    const cli = createStubChannel('cli');
    const telegram = createStubChannel('telegram');

    const registry = createChannelAdapterRegistry([cli, telegram]);

    expect(registry.get('cli')).toBe(cli);
    expect(registry.get('telegram')).toBe(telegram);
    expect(registry.get('wechat')).toBeUndefined();
    expect(Array.from(registry.platforms())).toEqual(['cli', 'telegram']);
    expect(registry.toMap()).toEqual(new Map<Platform, ChannelAdapterPort>([
      ['cli', cli],
      ['telegram', telegram]
    ]));
  });

  test('registers and unregisters adapters without leaking duplicate platforms', () => {
    const cli = createStubChannel('cli');
    const telegram = createStubChannel('telegram');
    const registry = createChannelAdapterRegistry([cli]);

    registry.register(telegram);
    expect(registry.get('telegram')).toBe(telegram);

    expect(registry.unregister('cli')).toBe(true);
    expect(registry.get('cli')).toBeUndefined();
    expect(registry.unregister('cli')).toBe(false);
    expect(Array.from(registry.platforms())).toEqual(['telegram']);
  });

  test('rejects duplicate platforms during construction and registration', () => {
    const cli = createStubChannel('cli');
    const duplicateCli = createStubChannel('cli');
    let constructionError: unknown;
    try {
      createChannelAdapterRegistry([cli, duplicateCli]);
    } catch (error) {
      constructionError = error;
    }
    expect(readCode(constructionError)).toBe(LINNSY_ERROR_CODES.CHANNEL_NOT_STARTED);

    const registry = createChannelAdapterRegistry([cli]);
    let registrationError: unknown;
    try {
      registry.register(duplicateCli);
    } catch (error) {
      registrationError = error;
    }
    expect(readCode(registrationError)).toBe(LINNSY_ERROR_CODES.CHANNEL_NOT_STARTED);
  });
});

function readCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  const code = error.code;
  return typeof code === 'string' ? code : undefined;
}

function createStubChannel(platform: Platform): ChannelAdapterPort {
  return {
    platform,
    start(handler: InboundHandler): Promise<void> {
      void handler;
      return Promise.resolve();
    },
    stop(): Promise<void> {
      return Promise.resolve();
    },
    send(target: SendTarget, payload: OutboundPayload) {
      void target;
      void payload;
      return Promise.resolve({ delivery: 'sent' });
    },
    healthcheck(): Promise<{ ok: boolean; detail?: string }> {
      return Promise.resolve({ ok: true });
    }
  };
}
