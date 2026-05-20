import { describe, expect, it } from 'vitest';

import { translateDaemonError } from '../error-translation.js';

describe('daemon error translation', () => {
  it('translates known LINNSY error codes into plain Chinese guidance', () => {
    expect(translateDaemonError('LINNSY_HTTP_BEARER_REQUIRED', 'zh-CN')).toEqual({
      title: '连接口令不对',
      suggestion: '请检查桌面端和后台服务使用的是同一份本地配置。'
    });
  });

  it('translates known LINNSY error codes into English guidance', () => {
    expect(translateDaemonError('LINNSY_HTTP_BEARER_REQUIRED', 'en-US')).toEqual({
      title: 'Connection token mismatch',
      suggestion: 'Check that the desktop app and background service use the same local config.'
    });
  });

  it('falls back without leaking stack-style wording for unknown codes', () => {
    expect(translateDaemonError('LINNSY_SOMETHING_NEW', 'zh-CN')).toEqual({
      title: 'Linnsy 暂时没处理好这件事',
      suggestion: '请稍后重试；如果一直出现，把这段错误码发给开发者。'
    });
  });
});
