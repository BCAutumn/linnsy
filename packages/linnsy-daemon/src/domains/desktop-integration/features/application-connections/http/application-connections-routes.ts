import { Hono } from 'hono';

import {
  type CodexConnectionState,
  createApplicationConnectionsSnapshot,
  type ApplicationConnectionsSnapshot
} from '../../../definitions/application-connections.js';

export interface ApplicationConnectionsCodexProbePort {
  probe(): Promise<CodexConnectionState>;
}

export interface CreateApplicationConnectionsRoutesOptions {
  codexProbe: ApplicationConnectionsCodexProbePort;
}

export function createApplicationConnectionsRoutes(options: CreateApplicationConnectionsRoutesOptions): Hono {
  const app = new Hono();

  app.get('/api/v1/application-connections', async (context) => {
    return context.json({
      ok: true,
      connections: await readApplicationConnections(options.codexProbe)
    });
  });

  app.post('/api/v1/application-connections/codex/probe', async (context) => {
    return context.json({
      ok: true,
      codex: await options.codexProbe.probe()
    });
  });

  return app;
}

async function readApplicationConnections(
  codexProbe: ApplicationConnectionsCodexProbePort
): Promise<ApplicationConnectionsSnapshot> {
  return createApplicationConnectionsSnapshot({
    codex: await codexProbe.probe()
  });
}
