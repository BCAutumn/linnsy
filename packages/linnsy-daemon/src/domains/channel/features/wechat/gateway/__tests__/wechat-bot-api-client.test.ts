import { describe, expect, test, vi } from 'vitest';

import { createWechatBotApiClient } from '../wechat-bot-api-client.js';

describe('WeChat bot API client', () => {
  test('posts official getupdates request shape and commits cursor only after acknowledgement', async () => {
    const fetch = vi
      .fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ret: 0,
        msgs: [
          {
            message_id: 101,
            from_user_id: 'wx_user_1',
            to_user_id: 'wx_bot',
            create_time_ms: 1_234,
            message_type: 1,
            context_token: 'ctx_1',
            item_list: [
              {
                type: 1,
                text_item: {
                  text: 'hello linnsy'
                }
              }
            ]
          }
        ],
        get_updates_buf: 'cursor_2'
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ret: 0,
        msgs: [],
        get_updates_buf: 'cursor_3'
      })));
    const client = createWechatBotApiClient({
      baseUrl: 'http://127.0.0.1:8800',
      botToken: 'wechat_bot_token',
      fetch
    });

    await expect(client.getUpdates()).resolves.toEqual({
      nextCursor: 'cursor_2',
      updates: [
        {
          providerMessageId: 'wx:101',
          fromUserId: 'wx_user_1',
          toUserId: 'wx_bot',
          messageType: 'user',
          text: 'hello linnsy',
          receivedAt: 1_234,
          contextToken: 'ctx_1',
          metadata: {
            messageId: 101,
            itemTypes: [1]
          }
        }
      ]
    });

    const firstCall = fetch.mock.calls[0];
    if (firstCall === undefined) {
      throw new Error('expected fetch call');
    }
    const firstUrl = firstCall[0];
    const firstInit = firstCall[1];
    expect(firstUrl).toBe('http://127.0.0.1:8800/ilink/bot/getupdates');
    expect(firstInit?.method).toBe('POST');
    expect(readHeader(firstInit?.headers, 'AuthorizationType')).toBe('ilink_bot_token');
    expect(readHeader(firstInit?.headers, 'Authorization')).toBe('Bearer wechat_bot_token');
    expect(readHeader(firstInit?.headers, 'Content-Type')).toBe('application/json');
    expect(typeof readHeader(firstInit?.headers, 'X-WECHAT-UIN')).toBe('string');
    expect(firstInit?.body).toBe(JSON.stringify({
      get_updates_buf: ''
    }));

    await client.commitCursor('cursor_2');
    await client.getUpdates();

    const secondCall = fetch.mock.calls[1];
    if (secondCall === undefined) {
      throw new Error('expected second fetch call');
    }
    const secondUrl = secondCall[0];
    const secondInit = secondCall[1];
    expect(secondUrl).toBe('http://127.0.0.1:8800/ilink/bot/getupdates');
    expect(secondInit?.body).toBe(JSON.stringify({
      get_updates_buf: 'cursor_2'
    }));
  });

  test('posts official sendmessage payload with full BOT/FINISH fields and accepts empty success body', async () => {
    const fetch = vi
      .fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(new Response(''));
    let clientIdCounter = 0;
    const client = createWechatBotApiClient({
      baseUrl: 'http://127.0.0.1:8800',
      botToken: 'wechat_bot_token',
      fetch,
      clientIdFactory: () => `client_${(++clientIdCounter).toString()}`
    });

    await expect(client.sendMessage({
      toUserId: 'wx_user_1',
      text: 'Task finished',
      contextToken: 'ctx_1'
    })).resolves.toBeUndefined();

    const firstCall = fetch.mock.calls[0];
    if (firstCall === undefined) {
      throw new Error('expected fetch call');
    }
    const calledUrl = firstCall[0];
    const calledInit = firstCall[1];
    expect(calledUrl).toBe('http://127.0.0.1:8800/ilink/bot/sendmessage');
    expect(calledInit?.method).toBe('POST');
    expect(readHeader(calledInit?.headers, 'AuthorizationType')).toBe('ilink_bot_token');
    expect(readHeader(calledInit?.headers, 'Authorization')).toBe('Bearer wechat_bot_token');
    expect(readHeader(calledInit?.headers, 'Content-Type')).toBe('application/json');
    expect(typeof readHeader(calledInit?.headers, 'X-WECHAT-UIN')).toBe('string');
    expect(calledInit?.body).toBe(JSON.stringify({
      msg: {
        from_user_id: '',
        to_user_id: 'wx_user_1',
        client_id: 'client_1',
        message_type: 2,
        message_state: 2,
        item_list: [
          {
            type: 1,
            text_item: {
              text: 'Task finished'
            }
          }
        ],
        context_token: 'ctx_1'
      }
    }));
  });

  test('sendmessage accepts empty JSON object success body without throwing', async () => {
    const fetch = vi
      .fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(new Response('{}', { headers: { 'content-type': 'application/json' } }));
    const client = createWechatBotApiClient({
      baseUrl: 'http://127.0.0.1:8800',
      botToken: 'wechat_bot_token',
      fetch
    });

    await expect(client.sendMessage({
      toUserId: 'wx_user_1',
      text: 'hi',
      contextToken: 'ctx_1'
    })).resolves.toBeUndefined();
  });

  test('sendmessage throws when WeChat bot API returns a non-zero ret code', async () => {
    const fetch = vi
      .fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(new Response(JSON.stringify({
        ret: -14,
        errcode: -14,
        errmsg: 'context_token expired'
      }), { headers: { 'content-type': 'application/json' } }));
    const client = createWechatBotApiClient({
      baseUrl: 'http://127.0.0.1:8800',
      botToken: 'wechat_bot_token',
      fetch
    });

    await expect(client.sendMessage({
      toUserId: 'wx_user_1',
      text: 'hi',
      contextToken: 'ctx_1'
    })).rejects.toThrow('WeChat bot API sendmessage failed: -14 context_token expired');
  });

  test('throws when getupdates returns a failed ret code', async () => {
    const fetch = vi
      .fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(new Response(JSON.stringify({
        ret: -14,
        errcode: -14,
        errmsg: 'session timeout'
      })));
    const client = createWechatBotApiClient({
      baseUrl: 'http://127.0.0.1:8800',
      botToken: 'wechat_bot_token',
      fetch
    });

    await expect(client.getUpdates()).rejects.toThrow('WeChat bot API getupdates failed: -14 session timeout');
  });

  test('accepts successful getupdates responses that omit ret', async () => {
    const fetch = vi
      .fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(new Response(JSON.stringify({
        msgs: [],
        sync_buf: 'compat_sync_buf',
        get_updates_buf: 'cursor_2'
      })));
    const client = createWechatBotApiClient({
      baseUrl: 'http://127.0.0.1:8800',
      botToken: 'wechat_bot_token',
      fetch
    });

    await expect(client.getUpdates()).resolves.toEqual({
      nextCursor: 'cursor_2',
      updates: []
    });
  });
});

function readHeader(headers: HeadersInit | undefined, key: string): string | undefined {
  if (headers === undefined) {
    return undefined;
  }
  if (headers instanceof Headers) {
    return headers.get(key) ?? undefined;
  }
  if (Array.isArray(headers)) {
    const match = headers.find(([name]) => name.toLowerCase() === key.toLowerCase());
    return match?.[1];
  }
  return headers[key];
}
