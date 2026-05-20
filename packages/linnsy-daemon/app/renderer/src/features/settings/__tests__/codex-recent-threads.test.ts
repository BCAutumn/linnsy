import { describe, expect, test } from 'vitest';

import {
  buildCodexThreadResumeCommand,
  getCodexThreadMeta,
  getCodexThreadTitle
} from '../codex-recent-threads.js';

describe('codex recent threads view helpers', () => {
  test('formats title, metadata, and resume command without reading thread content', () => {
    const thread = {
      id: '019e-thread',
      threadName: '可见接管研究',
      updatedAt: Date.parse('2026-05-14T10:30:00.000Z'),
      cwd: '/Users/tiansi/code/linnsy',
      source: 'exec'
    };

    expect(getCodexThreadTitle(thread, 'zh-CN')).toBe('可见接管研究');
    expect(getCodexThreadMeta(thread, 'zh-CN')).toContain('/Users/tiansi/code/linnsy');
    expect(getCodexThreadMeta(thread, 'zh-CN')).toContain('exec');
    expect(buildCodexThreadResumeCommand(thread)).toBe('codex resume --include-non-interactive 019e-thread');
  });

  test('uses localized fallback title for unnamed threads', () => {
    const thread = {
      id: '019e-thread',
      updatedAt: Date.parse('2026-05-14T10:30:00.000Z')
    };

    expect(getCodexThreadTitle(thread, 'zh-CN')).toBe('未命名 Codex 对话');
    expect(getCodexThreadTitle(thread, 'en-US')).toBe('Untitled Codex thread');
  });
});
