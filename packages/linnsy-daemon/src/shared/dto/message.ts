import { z } from 'zod';

import { jsonRecordSchema } from './common.js';

export const sendDesktopMessageInputSchema = z.object({
  text: z.string().min(1),
  conversationId: z.string().min(1).optional(),
  chatId: z.string().min(1).optional(),
  metadata: jsonRecordSchema.optional()
}).strict();

export type SendDesktopMessageInput = z.infer<typeof sendDesktopMessageInputSchema>;
