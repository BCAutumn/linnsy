import { t, type Locale } from '../../lib/i18n.js';

import type { ScheduledLoadError } from './scheduled-view-types.js';

/** 将异常归一化为可延迟翻译的结构（Error 文案保持原文，其余回落到通用重试提示）。 */
export function toScheduledLoadError(error: unknown): ScheduledLoadError {
  if (error instanceof Error) {
    return { kind: 'raw', message: error.message };
  }
  return { kind: 'i18n', key: 'operationRetryLater' };
}

/** 将结构化错误格式化为当前语言下的展示字符串。 */
export function formatScheduledLoadError(locale: Locale, error: ScheduledLoadError): string {
  if (error.kind === 'raw') {
    return error.message;
  }
  return t(locale, error.key, error.params ?? {});
}
