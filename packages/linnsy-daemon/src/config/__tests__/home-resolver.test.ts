import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import { getOsStandardLinnsyHome, resolveDefaultLinnsyHome } from '../home-resolver.js';

describe('home resolver', () => {
  test('lets explicit LINNSY_HOME override OS defaults', () => {
    expect(resolveDefaultLinnsyHome({
      env: {
        LINNSY_HOME: '/tmp/linnsy-dev',
        HOME: '/Users/alice'
      },
      platform: 'darwin'
    })).toBe('/tmp/linnsy-dev');
  });

  test('uses Application Support on macOS', () => {
    expect(getOsStandardLinnsyHome({
      env: { HOME: '/Users/alice' },
      platform: 'darwin'
    })).toBe(join('/Users/alice', 'Library', 'Application Support', 'Linnsy'));
  });

  test('uses APPDATA on Windows', () => {
    expect(getOsStandardLinnsyHome({
      env: { APPDATA: 'C:\\Users\\alice\\AppData\\Roaming', USERPROFILE: 'C:\\Users\\alice' },
      platform: 'win32'
    })).toBe('C:\\Users\\alice\\AppData\\Roaming\\Linnsy');
  });

  test('uses XDG data home on Linux', () => {
    expect(getOsStandardLinnsyHome({
      env: { HOME: '/home/alice', XDG_DATA_HOME: '/home/alice/.local/state' },
      platform: 'linux'
    })).toBe(join('/home/alice/.local/state', 'Linnsy'));
  });
});
