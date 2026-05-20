import { randomUUID } from 'node:crypto';

import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import type { DesktopMessageBusPort } from '../desktop-message-bus.js';

export interface CreateDesktopRoutesOptions {
  bus: DesktopMessageBusPort;
}

const desktopMessageSchema = z
  .object({
    text: z.string().min(1),
    conversationId: z.string().min(1).optional(),
    chatId: z.string().min(1).optional(),
    userId: z.string().min(1).optional(),
    metadata: z.record(z.unknown()).optional()
  })
  .strict();

export function createDesktopRoutes(options: CreateDesktopRoutesOptions): Hono {
  const app = new Hono();

  app.post(
    '/api/v1/desktop/messages',
    zValidator('json', desktopMessageSchema),
    async (context) => {
      const input = context.req.valid('json');
      await options.bus.receive({
        text: input.text,
        ...(input.conversationId === undefined ? {} : { conversationId: input.conversationId }),
        chatType: 'private',
        chatId: input.chatId ?? 'window:main',
        userId: input.userId ?? 'desktop-owner',
        providerMessageId: `desktop_in_${randomUUID()}`,
        ...(input.metadata === undefined ? {} : { metadata: input.metadata })
      });
      return context.json({ ok: true });
    }
  );

  return app;
}
