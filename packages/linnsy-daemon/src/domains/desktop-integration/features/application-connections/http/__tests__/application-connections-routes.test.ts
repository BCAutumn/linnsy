import { describe, expect, test, vi } from 'vitest';

import {
  type ApplicationConnectionsCodexProbePort,
  createApplicationConnectionsRoutes
} from '../application-connections-routes.js';

describe('application connections routes', () => {
  test('serves Codex probe state and unsupported app placeholders', async () => {
    const probe = vi.fn<ApplicationConnectionsCodexProbePort['probe']>(() => Promise.resolve({
      status: 'available',
      command: 'codex',
      checkedAt: 10,
      version: 'codex-cli 1.2.3'
    }));
    const app = createApplicationConnectionsRoutes({
      codexProbe: { probe }
    });

    const response = await app.request('/api/v1/application-connections');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      connections: {
        codex: {
          status: 'available',
          command: 'codex',
          checkedAt: 10,
          version: 'codex-cli 1.2.3'
        },
        claudeCode: { status: 'unsupported' },
        cursor: { status: 'unsupported' }
      }
    });
    expect(probe).toHaveBeenCalledTimes(1);
  });

  test('refreshes Codex only through the probe action', async () => {
    const probe = vi.fn<ApplicationConnectionsCodexProbePort['probe']>(() => Promise.resolve({
      status: 'not_found',
      command: 'codex',
      checkedAt: 11,
      errorMessage: 'spawn codex ENOENT'
    }));
    const app = createApplicationConnectionsRoutes({
      codexProbe: { probe }
    });

    const response = await app.request('/api/v1/application-connections/codex/probe', {
      method: 'POST'
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      codex: {
        status: 'not_found',
        command: 'codex',
        checkedAt: 11,
        errorMessage: 'spawn codex ENOENT'
      }
    });
  });
});
