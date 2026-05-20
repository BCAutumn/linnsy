import { create } from 'zustand';

import type { ApplicationConnectionsSnapshot } from '@renderer/contracts';
import type { ChannelDesktopStatus } from '@renderer/contracts';

export interface ApplicationConnectionsStoreSnapshot {
  applicationConnections: ApplicationConnectionsSnapshot | null;
  channelStatuses: ReadonlyMap<string, ChannelDesktopStatus>;
}

export function createEmptyApplicationConnectionsStoreSnapshot(): ApplicationConnectionsStoreSnapshot {
  return {
    applicationConnections: null,
    channelStatuses: new Map()
  };
}

export const useApplicationConnectionsStore = create<ApplicationConnectionsStoreSnapshot>(() => (
  createEmptyApplicationConnectionsStoreSnapshot()
));

export function replaceApplicationConnectionsStore(snapshot: ApplicationConnectionsStoreSnapshot): void {
  useApplicationConnectionsStore.setState(snapshot, true);
}
