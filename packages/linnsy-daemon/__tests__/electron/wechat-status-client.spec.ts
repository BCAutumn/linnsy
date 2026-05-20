import {
  createWechatGatewayStatusClient,
  parseWechatGatewaySnapshot
} from '../../electron/channels/wechat/wechat-gateway-status-client.js';

describe('createWechatGatewayStatusClient', () => {
  test('reads the full gateway status snapshot', async () => {
    const client = createWechatGatewayStatusClient({
      baseUrl: 'http://127.0.0.1:7788',
      bearerToken: 'secret',
      fetchImpl: createStatusFetch('awaiting_qr_scan')
    });

    await expect(client.readSnapshot()).resolves.toEqual({
      ok: true,
      account: null,
      connection: {
        state: 'awaiting_qr_scan',
        qrLoginUrl: 'https://example.com/wechat-qr',
        qrLoginExpiresAt: 320
      },
      outbound: {
        deferredReadyCount: 0,
        deferredClaimedCount: 0
      }
    });
  });

  test('deletes the gateway account and reads the returned status snapshot', async () => {
    const calls: Array<{ url: string; method: string | undefined }> = [];
    const client = createWechatGatewayStatusClient({
      baseUrl: 'http://127.0.0.1:7788',
      bearerToken: 'secret',
      fetchImpl: (input, init) => {
        calls.push({
          url: input instanceof URL ? input.href : input instanceof Request ? input.url : input,
          method: init?.method
        });
        return createStatusFetch('not_connected')(input, init);
      }
    });

    await expect(client.deleteAccount()).resolves.toMatchObject({
      connection: {
        state: 'not_connected'
      }
    });
    expect(calls).toEqual([
      {
        url: 'http://127.0.0.1:7788/v1/account',
        method: 'DELETE'
      }
    ]);
  });

  test('requests a fresh QR login through the dedicated endpoint', async () => {
    const calls: Array<{ url: string; method: string | undefined }> = [];
    const client = createWechatGatewayStatusClient({
      baseUrl: 'http://127.0.0.1:7788',
      bearerToken: 'secret',
      fetchImpl: (input, init) => {
        calls.push({
          url: input instanceof URL ? input.href : input instanceof Request ? input.url : input,
          method: init?.method
        });
        return createStatusFetch('awaiting_qr_scan')(input, init);
      }
    });

    await expect(client.requestFreshQrLogin()).resolves.toMatchObject({
      connection: {
        state: 'awaiting_qr_scan',
        qrLoginUrl: 'https://example.com/wechat-qr',
        qrLoginExpiresAt: 320
      }
    });
    expect(calls).toEqual([
      {
        url: 'http://127.0.0.1:7788/v1/qr-login/show',
        method: 'POST'
      }
    ]);
  });

  test('throws when the gateway rejects the bearer token', async () => {
    const client = createWechatGatewayStatusClient({
      baseUrl: 'http://127.0.0.1:7788',
      bearerToken: 'wrong-secret',
      fetchImpl: createResponseFetch(new Response('unauthorized', {
        status: 401,
        statusText: 'Unauthorized'
      }))
    });

    await expect(client.readSnapshot()).rejects.toThrow('wechat gateway status failed: 401 Unauthorized');
  });

  test('throws when the status payload is missing required fields', () => {
    expect(() => parseWechatGatewaySnapshot({
      ok: true,
      account: null,
      connection: {
        state: 'connected'
      }
    })).toThrow('invalid wechat gateway status payload');
  });

  test('throws when fetch cannot reach the gateway', async () => {
    const client = createWechatGatewayStatusClient({
      baseUrl: 'http://127.0.0.1:7788',
      bearerToken: 'secret',
      fetchImpl: createRejectingFetch(new Error('connection refused'))
    });

    await expect(client.readSnapshot()).rejects.toThrow('connection refused');
  });
});

function createStatusFetch(state: 'not_connected' | 'starting' | 'awaiting_qr_scan' | 'connected' | 'degraded'): typeof fetch {
  return () => Promise.resolve(new Response(JSON.stringify({
    ok: state === 'starting' || state === 'awaiting_qr_scan' || state === 'connected',
    account: null,
    connection: {
      state,
      ...(state === 'awaiting_qr_scan' ? { qrLoginUrl: 'https://example.com/wechat-qr', qrLoginExpiresAt: 320 } : {})
    },
    outbound: {
      deferredReadyCount: 0,
      deferredClaimedCount: 0
    }
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  }));
}

function createResponseFetch(response: Response): typeof fetch {
  return () => Promise.resolve(response);
}

function createRejectingFetch(error: Error): typeof fetch {
  return () => Promise.reject(error);
}
