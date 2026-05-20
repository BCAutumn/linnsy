import { describe, expect, test } from 'vitest';

import {
  describeCodexConnection,
  getCodexConnectionActionLabel,
  getCodexStatusTone
} from '../application-connections-status.js';

describe('application connection status copy', () => {
  test('describes Codex probe states in Chinese', () => {
    expect(describeCodexConnection('zh-CN', null, false)).toBe('Codex 未启动');
    expect(describeCodexConnection('zh-CN', null, true)).toBe('正在检测 Codex');
    expect(describeCodexConnection('zh-CN', {
      status: 'available',
      command: 'codex',
      checkedAt: 1,
      version: 'codex-cli 1.2.3'
    }, false)).toBe('Codex CLI 可用 · codex-cli 1.2.3');
    expect(describeCodexConnection('zh-CN', {
      status: 'not_found',
      command: 'codex',
      checkedAt: 1
    }, false)).toBe('未找到 Codex CLI');
    expect(describeCodexConnection('zh-CN', {
      status: 'failed',
      command: 'codex',
      checkedAt: 1,
      errorMessage: 'exitCode=2'
    }, false)).toBe('Codex 检测失败：exitCode=2');
  });

  test('maps action label and tone without React state', () => {
    expect(getCodexConnectionActionLabel('zh-CN', false)).toBe('检测 Codex');
    expect(getCodexConnectionActionLabel('zh-CN', true)).toBe('检测中');
    expect(getCodexStatusTone(null)).toBe('offline');
    expect(getCodexStatusTone({
      status: 'available',
      command: 'codex',
      checkedAt: 1
    })).toBe('online');
  });
});
