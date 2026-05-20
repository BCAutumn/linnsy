import type { ZodType } from 'zod';

import type { ListMemoryItemsOptions } from '@renderer/contracts';

export async function requestJson<Output>(
  fetchFn: typeof fetch,
  url: string,
  headers: Record<string, string>,
  schema: ZodType<Output>,
  init: RequestInit = {}
): Promise<Output> {
  const response = await fetchFn(url, {
    ...init,
    headers: {
      ...headers,
      ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' })
    }
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    throw body;
  }
  return schema.parse(body);
}

export function conversationUrl(baseUrl: string, conversationId: string): string {
  return `${baseUrl}/api/v1/conversations/${encodeURIComponent(conversationId)}`;
}

export function createMemoryItemsQuerySuffix(options: ListMemoryItemsOptions): string {
  const params = new URLSearchParams();
  if (options.query !== undefined && options.query.trim().length > 0) {
    params.set('query', options.query);
  }
  if (options.scope !== undefined && options.scope.trim().length > 0) {
    params.set('scope', options.scope);
  }
  if (options.limit !== undefined) {
    params.set('limit', String(options.limit));
  }
  return params.size === 0 ? '' : `?${params.toString()}`;
}
