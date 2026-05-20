import type { CodexConnectionState } from '@renderer/contracts';
import type { Locale } from '../../lib/i18n.js';
import { t } from '../../lib/i18n.js';

export function describeCodexConnection(
  locale: Locale,
  codex: CodexConnectionState | null,
  checking: boolean
): string {
  if (checking) {
    return t(locale, 'codexChecking');
  }
  if (codex === null) {
    return t(locale, 'codexNotStarted');
  }
  if (codex.status === 'available') {
    return codex.version === undefined
      ? t(locale, 'codexAvailable')
      : t(locale, 'codexAvailableWithVersion', { version: codex.version });
  }
  if (codex.status === 'not_found') {
    return t(locale, 'codexNotFound');
  }
  return t(locale, 'codexFailed', { error: codex.errorMessage ?? t(locale, 'operationRetryLater') });
}

export function getCodexConnectionActionLabel(locale: Locale, checking: boolean): string {
  return checking ? t(locale, 'codexCheckingAction') : t(locale, 'codexConnect');
}

export function getCodexStatusTone(codex: CodexConnectionState | null): 'offline' | 'online' {
  return codex?.status === 'available' ? 'online' : 'offline';
}
