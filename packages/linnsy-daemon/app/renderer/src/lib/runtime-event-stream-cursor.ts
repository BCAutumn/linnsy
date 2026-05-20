import type { RuntimeEventEnvelope } from '@renderer/contracts';

export interface RuntimeEventStreamCursor {
  markSeen(event: RuntimeEventEnvelope): void;
  reset(): void;
  toStreamUrl(baseUrl: string): string;
}

export function createRuntimeEventStreamCursor(): RuntimeEventStreamCursor {
  let lastSeenSeq = 0;

  return {
    markSeen(event) {
      lastSeenSeq = Math.max(lastSeenSeq, event.seq);
    },
    reset() {
      lastSeenSeq = 0;
    },
    toStreamUrl(baseUrl) {
      return buildRuntimeEventStreamUrl(baseUrl, lastSeenSeq);
    }
  };
}

export function buildRuntimeEventStreamUrl(baseUrl: string, sinceSeq: number): string {
  const url = new URL('/api/v1/stream', baseUrl);
  if (sinceSeq > 0) {
    url.searchParams.set('since', String(sinceSeq));
  }
  if (url.protocol === 'https:') {
    url.protocol = 'wss:';
  } else {
    url.protocol = 'ws:';
  }
  return url.toString();
}
