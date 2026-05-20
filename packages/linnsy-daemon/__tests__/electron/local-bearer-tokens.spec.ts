import { join } from 'node:path';

import { resolveLocalBearerTokens, type BearerStorageFs } from '../../electron/local-bearer-tokens.js';

const SPECS = [
  { envName: 'LINNSY_WEB_BEARER', storageKey: 'web' as const },
  { envName: 'LINNSY_WECHAT_GATEWAY_BEARER', storageKey: 'wechat-gateway' as const }
];

describe('resolveLocalBearerTokens', () => {
  test('uses environment value when present and does not touch persisted file', async () => {
    const fs = createMemoryFs();
    let nextGenerated = 0;

    const result = await resolveLocalBearerTokens({
      userDataDir: '/tmp/userdata',
      specs: SPECS,
      env: {
        LINNSY_WEB_BEARER: 'env-web-token',
        LINNSY_WECHAT_GATEWAY_BEARER: 'env-wechat-token'
      },
      generate: () => `generated-${(nextGenerated += 1).toString()}`,
      fs
    });

    expect(result).toEqual({
      LINNSY_WEB_BEARER: 'env-web-token',
      LINNSY_WECHAT_GATEWAY_BEARER: 'env-wechat-token'
    });
    expect(fs.snapshot()).toEqual({});
    expect(nextGenerated).toBe(0);
  });

  test('reuses persisted tokens across resolves so daemon and gateway always pair up', async () => {
    const fs = createMemoryFs({
      [join('/tmp/userdata', 'local-bearer-tokens.json')]:
        JSON.stringify({ web: 'persisted-web', 'wechat-gateway': 'persisted-wechat' })
    });
    let nextGenerated = 0;

    const result = await resolveLocalBearerTokens({
      userDataDir: '/tmp/userdata',
      specs: SPECS,
      env: {},
      generate: () => `generated-${(nextGenerated += 1).toString()}`,
      fs
    });

    expect(result).toEqual({
      LINNSY_WEB_BEARER: 'persisted-web',
      LINNSY_WECHAT_GATEWAY_BEARER: 'persisted-wechat'
    });
    expect(nextGenerated).toBe(0);
  });

  test('generates and persists a fresh token when neither env nor file has it', async () => {
    const fs = createMemoryFs();
    let counter = 0;

    const first = await resolveLocalBearerTokens({
      userDataDir: '/tmp/userdata',
      specs: SPECS,
      env: {},
      generate: () => `generated-${(counter += 1).toString()}`,
      fs
    });

    expect(first.LINNSY_WEB_BEARER).toBe('generated-1');
    expect(first.LINNSY_WECHAT_GATEWAY_BEARER).toBe('generated-2');
    expect(fs.snapshot()).toEqual({
      [join('/tmp/userdata', 'local-bearer-tokens.json')]:
        `${JSON.stringify({ web: 'generated-1', 'wechat-gateway': 'generated-2' }, null, 2)}\n`
    });

    const second = await resolveLocalBearerTokens({
      userDataDir: '/tmp/userdata',
      specs: SPECS,
      env: {},
      generate: () => 'should-not-be-called',
      fs
    });
    expect(second).toEqual(first);
  });

  test('treats malformed persisted file as empty without crashing', async () => {
    const fs = createMemoryFs({
      [join('/tmp/userdata', 'local-bearer-tokens.json')]: 'not-json{{'
    });

    const result = await resolveLocalBearerTokens({
      userDataDir: '/tmp/userdata',
      specs: SPECS,
      env: {},
      generate: () => 'fresh',
      fs
    });

    expect(result.LINNSY_WEB_BEARER).toBe('fresh');
    expect(result.LINNSY_WECHAT_GATEWAY_BEARER).toBe('fresh');
  });

  test('env value takes precedence over persisted value', async () => {
    const fs = createMemoryFs({
      [join('/tmp/userdata', 'local-bearer-tokens.json')]:
        JSON.stringify({ web: 'persisted-web', 'wechat-gateway': 'persisted-wechat' })
    });

    const result = await resolveLocalBearerTokens({
      userDataDir: '/tmp/userdata',
      specs: SPECS,
      env: { LINNSY_WEB_BEARER: 'shell-override' },
      generate: () => 'should-not-be-called',
      fs
    });

    expect(result).toEqual({
      LINNSY_WEB_BEARER: 'shell-override',
      LINNSY_WECHAT_GATEWAY_BEARER: 'persisted-wechat'
    });
  });

  test('fills in only the missing token without overwriting other persisted entries', async () => {
    const fs = createMemoryFs({
      [join('/tmp/userdata', 'local-bearer-tokens.json')]:
        JSON.stringify({ web: 'persisted-web' })
    });

    const result = await resolveLocalBearerTokens({
      userDataDir: '/tmp/userdata',
      specs: SPECS,
      env: {},
      generate: () => 'newly-generated',
      fs
    });

    expect(result).toEqual({
      LINNSY_WEB_BEARER: 'persisted-web',
      LINNSY_WECHAT_GATEWAY_BEARER: 'newly-generated'
    });
    const persistedRaw = fs.snapshot()[join('/tmp/userdata', 'local-bearer-tokens.json')];
    expect(persistedRaw).toBeDefined();
    expect(JSON.parse(persistedRaw ?? '')).toEqual({
      web: 'persisted-web',
      'wechat-gateway': 'newly-generated'
    });
  });
});

interface MemoryFs extends BearerStorageFs {
  snapshot(): Record<string, string>;
}

function createMemoryFs(initial: Record<string, string> = {}): MemoryFs {
  const files = new Map<string, string>(Object.entries(initial));
  return {
    readFile(path) {
      const value = files.get(path);
      if (value === undefined) {
        const error = new Error('ENOENT') as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        return Promise.reject(error);
      }
      return Promise.resolve(value);
    },
    writeFile(path, data) {
      files.set(path, data);
      return Promise.resolve();
    },
    ensureDir() {
      // memory fs：目录无意义
      return Promise.resolve();
    },
    snapshot() {
      return Object.fromEntries(files.entries());
    }
  };
}
