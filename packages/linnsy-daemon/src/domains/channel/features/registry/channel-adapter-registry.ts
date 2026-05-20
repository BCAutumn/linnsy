import { LINNSY_ERROR_CODES, LinnsyError } from '../../../../shared/errors.js';
import type { Platform } from '../../../../shared/messaging.js';

import type { ChannelAdapterPort } from '../../definitions/types.js';

export interface ChannelAdapterRegistryPort {
  register(adapter: ChannelAdapterPort): void;
  unregister(platform: Platform): boolean;
  get(platform: Platform): ChannelAdapterPort | undefined;
  platforms(): IterableIterator<Platform>;
  adapters(): IterableIterator<ChannelAdapterPort>;
  toMap(): Map<Platform, ChannelAdapterPort>;
}

export function createChannelAdapterRegistry(
  initialAdapters: Iterable<ChannelAdapterPort> = []
): ChannelAdapterRegistryPort {
  const adapters = new Map<Platform, ChannelAdapterPort>();

  const registry: ChannelAdapterRegistryPort = {
    register(adapter: ChannelAdapterPort): void {
      if (adapters.has(adapter.platform)) {
        throw new LinnsyError(
          LINNSY_ERROR_CODES.CHANNEL_NOT_STARTED,
          `duplicate channel adapter for platform ${String(adapter.platform)}`,
          false
        );
      }
      adapters.set(adapter.platform, adapter);
    },

    unregister(platform: Platform): boolean {
      return adapters.delete(platform);
    },

    get(platform: Platform): ChannelAdapterPort | undefined {
      return adapters.get(platform);
    },

    platforms(): IterableIterator<Platform> {
      return adapters.keys();
    },

    adapters(): IterableIterator<ChannelAdapterPort> {
      return adapters.values();
    },

    toMap(): Map<Platform, ChannelAdapterPort> {
      return new Map(adapters);
    }
  };

  for (const adapter of initialAdapters) {
    registry.register(adapter);
  }

  return registry;
}
