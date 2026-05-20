import { describe, expect, test } from 'vitest';
import { ZodError } from 'zod';

import { createDaemonApiClient } from '../daemon-client.js';

describe('createDaemonApiClient', () => {
  test('parses REST DTOs through shared schemas', async () => {
    const client = createDaemonApiClient({
      baseUrl: 'http://daemon.test',
      bearerToken: 'token',
      fetchFn: createJsonFetch({
        conversations: [
          {
            conversationId: 'conv_1',
            platform: 'desktop',
            chatType: 'private',
            chatId: 'window:main',
            updatedAt: 1,
            lastActivityAt: 1
          }
        ]
      })
    });

    await expect(client.listConversations()).resolves.toEqual([
      {
        conversationId: 'conv_1',
        platform: 'desktop',
        chatType: 'private',
        chatId: 'window:main',
        updatedAt: 1,
        lastActivityAt: 1
      }
    ]);
  });

  test('rejects malformed REST DTOs before they reach renderer state', async () => {
    const client = createDaemonApiClient({
      baseUrl: 'http://daemon.test',
      bearerToken: 'token',
      fetchFn: createJsonFetch({
        conversations: [{ conversationId: 'conv_missing_required_fields' }]
      })
    });

    await expect(client.listConversations()).rejects.toBeInstanceOf(ZodError);
  });
});

function createJsonFetch(body: unknown): typeof fetch {
  return function jsonFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    void input;
    void init;
    return Promise.resolve(new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }));
  };
}
