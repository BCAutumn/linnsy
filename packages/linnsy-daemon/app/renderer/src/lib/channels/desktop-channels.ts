import { useEffect, useMemo, useState } from 'react';

import type { ChannelDesktopStatus } from '@renderer/contracts';
import { getDesktopBridge } from '../desktop-bridge.js';
import { t, type Locale } from '../i18n.js';

export interface ChannelStatusesState {
  byId: ReadonlyMap<string, ChannelDesktopStatus>;
  isAvailable: boolean;
}

export function useChannelStatuses(): ChannelStatusesState {
  const bridge = getDesktopBridge();
  const [statuses, setStatuses] = useState<ReadonlyMap<string, ChannelDesktopStatus>>(() => new Map());
  const isAvailable = bridge !== undefined && bridge.listChannels !== undefined && bridge.onChannelStatusChanged !== undefined;

  useEffect(() => {
    if (bridge === undefined || bridge.listChannels === undefined || bridge.onChannelStatusChanged === undefined) {
      return undefined;
    }

    let mounted = true;
    void bridge.listChannels()
      .then((next) => {
        if (!mounted) {
          return;
        }
        setStatuses(createStatusMap(next));
      })
      .catch((error: unknown) => {
        console.warn('failed to list desktop channel statuses', error);
      });

    const unsubscribe = bridge.onChannelStatusChanged((status) => {
      if (!mounted) {
        return;
      }
      setStatuses((current) => {
        const next = new Map(current);
        next.set(status.channelId, status);
        return next;
      });
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [bridge, isAvailable]);

  return useMemo(() => ({
    byId: statuses,
    isAvailable
  }), [isAvailable, statuses]);
}

export function getChannelLifecycleLabel(locale: Locale, status: ChannelDesktopStatus | undefined): string {
  if (status === undefined) {
    return t(locale, 'channelIdle');
  }
  switch (status.lifecycle) {
    case 'idle':
      return t(locale, 'terminalNotConnected');
    case 'starting':
      return t(locale, 'connectingTerminal');
    case 'awaiting_login':
      return t(locale, 'terminalNotConnected');
    case 'connected':
      return t(locale, 'wechatConnected');
    case 'degraded':
      return t(locale, 'terminalDegraded');
  }
}

export function getWechatStatus(statuses: ReadonlyMap<string, ChannelDesktopStatus>): ChannelDesktopStatus | undefined {
  return statuses.get('wechat');
}

function createStatusMap(statuses: ChannelDesktopStatus[]): ReadonlyMap<string, ChannelDesktopStatus> {
  const byId = new Map<string, ChannelDesktopStatus>();
  for (const status of statuses) {
    byId.set(status.channelId, status);
  }
  return byId;
}
