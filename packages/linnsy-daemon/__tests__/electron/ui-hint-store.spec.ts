import { join } from 'node:path';

import { createUiHintStore, type UiHintStorageFs } from '../../electron/ui-hint-store.js';
import type { UiHint } from '../../src/domains/desktop-integration/definitions/ui-hint-contract.js';

const USER_DATA_DIR = '/tmp/userdata';
const HINT_PATH = join(USER_DATA_DIR, 'last-ui-hint.json');

const SAMPLE_HINT: UiHint = {
  'theme.mode': 'dark',
  'theme.primary_color': 'pine_cypress',
  'font.size': 'medium',
  'sidebar.width_px': 280,
  'sidebar.archived_collapsed': true,
  language: 'zh-CN'
};

describe('createUiHintStore', () => {
  test('exposes the resolved hint file path so main can pass it to preload via additionalArguments', () => {
    const fs = createMemoryFs();
    const store = createUiHintStore({ userDataDir: USER_DATA_DIR, fs });
    expect(store.filePath).toBe(HINT_PATH);
  });

  test('returns null when the hint file does not yet exist (first launch)', async () => {
    const fs = createMemoryFs();
    const store = createUiHintStore({ userDataDir: USER_DATA_DIR, fs });
    expect(await store.read()).toBeNull();
  });

  test('returns null and does not throw when the hint file is corrupted JSON', async () => {
    const fs = createMemoryFs({ [HINT_PATH]: '{not-json' });
    const store = createUiHintStore({ userDataDir: USER_DATA_DIR, fs });
    expect(await store.read()).toBeNull();
  });

  test('returns null when the hint file misses any required field (sanitize all-or-nothing)', async () => {
    const partial = { ...SAMPLE_HINT };
    // 故意制造缺失：删一个必要字段。
    delete (partial as Partial<UiHint>)['font.size'];
    const fs = createMemoryFs({ [HINT_PATH]: JSON.stringify(partial) });
    const store = createUiHintStore({ userDataDir: USER_DATA_DIR, fs });
    expect(await store.read()).toBeNull();
  });

  test('returns null when sidebar width drifts outside the renderer range', async () => {
    const fs = createMemoryFs({
      [HINT_PATH]: JSON.stringify({ ...SAMPLE_HINT, 'sidebar.width_px': 400 })
    });
    const store = createUiHintStore({ userDataDir: USER_DATA_DIR, fs });
    expect(await store.read()).toBeNull();
  });

  test('round-trips a sanitized hint via write -> read', async () => {
    const fs = createMemoryFs();
    const store = createUiHintStore({ userDataDir: USER_DATA_DIR, fs });
    await store.write(SAMPLE_HINT);
    expect(await store.read()).toEqual(SAMPLE_HINT);
  });

  test('write ensures the parent directory exists before persisting', async () => {
    const fs = createMemoryFs();
    const store = createUiHintStore({ userDataDir: USER_DATA_DIR, fs });
    await store.write(SAMPLE_HINT);
    expect(fs.dirsEnsured).toContain(USER_DATA_DIR);
    expect(fs.snapshot()[HINT_PATH]).toBe(`${JSON.stringify(SAMPLE_HINT, null, 2)}\n`);
  });

  test('drops fields outside the hint whitelist when sanitizing on read', async () => {
    const polluted = { ...SAMPLE_HINT, last_opened_conversation_id: 'conv-42', extraneous: 'noise' };
    const fs = createMemoryFs({ [HINT_PATH]: JSON.stringify(polluted) });
    const store = createUiHintStore({ userDataDir: USER_DATA_DIR, fs });
    const read = await store.read();
    expect(read).toEqual(SAMPLE_HINT);
    // 业务态字段不应回到 hint，避免 main 持久化出无意义副作用。
    expect(read && Object.keys(read)).not.toContain('last_opened_conversation_id');
  });

  test('returns null when reading a non-ENOENT IO failure to keep main bootstrap alive', async () => {
    const fs: UiHintStorageFs = {
      readFile: () => Promise.reject(Object.assign(new Error('EACCES'), { code: 'EACCES' })),
      writeFile: () => Promise.resolve(),
      ensureDir: () => Promise.resolve()
    };
    const store = createUiHintStore({ userDataDir: USER_DATA_DIR, fs });
    expect(await store.read()).toBeNull();
  });
});

interface MemoryFs extends UiHintStorageFs {
  snapshot(): Record<string, string>;
  dirsEnsured: string[];
}

function createMemoryFs(initial: Record<string, string> = {}): MemoryFs {
  const files = new Map<string, string>(Object.entries(initial));
  const dirsEnsured: string[] = [];
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
    ensureDir(path) {
      dirsEnsured.push(path);
      return Promise.resolve();
    },
    snapshot() {
      return Object.fromEntries(files.entries());
    },
    dirsEnsured
  };
}
