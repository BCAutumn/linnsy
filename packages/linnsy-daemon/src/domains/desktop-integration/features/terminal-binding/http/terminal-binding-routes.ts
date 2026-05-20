import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import { LINNSY_ERROR_CODES, LinnsyError } from '../../../../../shared/errors.js';
import type { TerminalBindingServicePort } from '../terminal-binding-service.js';

export interface CreateTerminalBindingRoutesOptions {
  terminalBinding: TerminalBindingServicePort;
}

const updateTerminalBindingSchema = z.object({
  conversationId: z.string().min(1)
}).strict();

export function createTerminalBindingRoutes(options: CreateTerminalBindingRoutesOptions): Hono {
  const app = new Hono();

  app.get('/api/v1/terminal-binding', async (context) => {
    const binding = await options.terminalBinding.getBinding();
    return context.json({ ok: true, binding });
  });

  app.put(
    '/api/v1/terminal-binding',
    zValidator('json', updateTerminalBindingSchema),
    async (context) => {
      const input = context.req.valid('json');
      try {
        const binding = await options.terminalBinding.bindToConversation(input.conversationId, 'desktop-settings');
        return context.json({ ok: true, binding });
      } catch (error: unknown) {
        if (error instanceof LinnsyError && error.code === LINNSY_ERROR_CODES.SESSION_NOT_FOUND) {
          return context.json({
            ok: false,
            code: error.code,
            message: error.message
          }, 404);
        }
        throw error;
      }
    }
  );

  return app;
}
