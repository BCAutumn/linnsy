import type { DaemonApiClient } from '../lib/daemon-api.js';
import type { DaemonDesktopStatus } from '../lib/desktop-bridge.js';
import { translateDaemonError } from '../lib/error-translation.js';
import { t, type Locale } from '../lib/i18n.js';
import {
  delay,
  isRetryableConnectionError,
  loadInitialDesktopData,
  type InitialDesktopData
} from './desktop-data.js';

interface ConnectDesktopOptions {
  cancelled(): boolean;
  onRetry(): void;
  onConnected(client: DaemonApiClient, initialData: InitialDesktopData): void;
  onFailure(error: unknown, retrying: boolean): void;
  retryDelayMs?: number;
}

const lastConnectedAtStorageKey = 'linnsy.desktop.lastConnectedAt';
const recentConnectionWindowMs = 120000;

export async function connectDesktop(
  clientFactory: () => Promise<DaemonApiClient>,
  options: ConnectDesktopOptions
): Promise<void> {
  while (!options.cancelled()) {
    try {
      const client = await clientFactory();
      const initialData = await loadInitialDesktopData(client, () => {
        options.onRetry();
      });
      if (!options.cancelled()) {
        options.onConnected(client, initialData);
      }
      return;
    } catch (error: unknown) {
      const retrying = isRetryableConnectionError(error);
      options.onFailure(error, retrying);
      if (!retrying) {
        return;
      }
      await delay(options.retryDelayMs ?? 2000);
    }
  }
}

export function markConnected(): void {
  try {
    window.sessionStorage.setItem(lastConnectedAtStorageKey, String(Date.now()));
  } catch {
    // Session storage 只优化重连期间的状态文案，连接正确性不能依赖它。
  }
}

export function wasRecentlyConnected(now = Date.now()): boolean {
  try {
    const raw = window.sessionStorage.getItem(lastConnectedAtStorageKey);
    if (raw === null) {
      return false;
    }
    const connectedAt = Number.parseInt(raw, 10);
    return Number.isFinite(connectedAt) && now - connectedAt <= recentConnectionWindowMs;
  } catch {
    return false;
  }
}

export function translateUnknownError(error: unknown, locale: Locale): { title: string; suggestion: string } {
  if (isErrorBody(error)) {
    return translateDaemonError(error.code, locale);
  }
  if (error instanceof Error) {
    if (isRetryableConnectionError(error)) {
      return {
        title: t(locale, 'connectionFailedTitle'),
        suggestion: t(locale, 'connectionFailedSuggestion')
      };
    }
    return { title: t(locale, 'connectionFailedTitle'), suggestion: error.message };
  }
  return { title: t(locale, 'connectionFailedTitle'), suggestion: t(locale, 'connectionFailedFallbackSuggestion') };
}

export function formatErrorBanner(locale: Locale, readable: { title: string; suggestion: string }): string {
  return t(locale, 'errorJoiner', readable);
}

export function formatDaemonStatusBanner(locale: Locale, status: DaemonDesktopStatus): string {
  const detail = status.detail ?? (status.exitCode === undefined ? '' : `exitCode=${status.exitCode.toString()}`);
  const suggestion = t(locale, status.lifecycle === 'failed' ? 'daemonFailedSuggestion' : 'daemonStoppedSuggestion', {
    detail
  });
  return formatErrorBanner(locale, {
    title: t(locale, status.lifecycle === 'failed' ? 'daemonFailedTitle' : 'daemonStoppedTitle'),
    suggestion
  });
}

function isErrorBody(value: unknown): value is { code: string } {
  return typeof value === 'object'
    && value !== null
    && 'code' in value
    && typeof value.code === 'string';
}
