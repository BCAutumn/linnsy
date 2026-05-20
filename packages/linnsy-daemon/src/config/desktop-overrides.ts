import type { LinnsyConfig } from './schema.js';

const DEFAULT_DESKTOP_DAEMON_URL = 'http://127.0.0.1:7700';
const DESKTOP_BEARER_ENV = 'LINNSY_WEB_BEARER';

export function applyDesktopRuntimeOverrides(
  config: LinnsyConfig,
  env: Record<string, string | undefined> = process.env
): LinnsyConfig {
  if (env.LINNSY_DESKTOP_MODE !== '1') {
    return config;
  }

  return {
    ...config,
    channels: {
      ...config.channels,
      web: {
        enabled: true,
        bind: toBindAddress(env.LINNSY_DAEMON_URL ?? DEFAULT_DESKTOP_DAEMON_URL),
        bearer_env: DESKTOP_BEARER_ENV
      },
      ...(config.channels.wechat === undefined
        ? {}
        : {
            wechat: {
              ...config.channels.wechat,
              enabled: env.LINNSY_DESKTOP_WECHAT_CONNECT === '1'
            }
          })
    }
  };
}

function toBindAddress(urlText: string): string {
  const url = new URL(urlText);
  const hostname = url.hostname === 'localhost' ? '127.0.0.1' : url.hostname;
  const port = url.port === '' ? '7700' : url.port;
  return `${hostname}:${port}`;
}
