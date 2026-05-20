import { randomUUID } from 'node:crypto';

import type { OutboundPayload } from '../../../../shared/messaging.js';
import type {
  ChannelHealth
} from '../../definitions/types.js';
import type {
  DesktopConnectionPort,
  DesktopInboundPayload,
  DesktopSendResult
} from './desktop-channel-adapter.js';

export interface DesktopMessageBusPort extends DesktopConnectionPort {
  receive(payload: DesktopInboundPayload): Promise<void>;
}

export interface CreateDesktopMessageBusOptions {
  idFactory?: () => string;
}

export function createDesktopMessageBus(
  options: CreateDesktopMessageBusOptions = {}
): DesktopMessageBusPort {
  const idFactory = options.idFactory ?? defaultIdFactory;
  const listeners = new Set<(payload: DesktopInboundPayload) => void | Promise<void>>();

  return {
    onMessage(listener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    receive(payload): Promise<void> {
      return Promise.all(Array.from(listeners, async (listener) => {
        await listener(payload);
      })).then(() => undefined);
    },

    send(chatId: string, payload: OutboundPayload): Promise<DesktopSendResult> {
      void chatId;
      void payload;
      const id = idFactory();
      return Promise.resolve({ providerMessageId: id });
    },

    healthcheck(): Promise<ChannelHealth> {
      return Promise.resolve({
        ok: listeners.size > 0,
        detail: listeners.size > 0 ? 'desktop message bus connected' : 'desktop message bus has no listeners'
      });
    }
  };
}

function defaultIdFactory(): string {
  return `desktop_out_${randomUUID()}`;
}
