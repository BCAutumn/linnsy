import type { Context, Env, MiddlewareHandler } from 'hono';

import { LINNSY_ERROR_CODES } from '../../shared/errors.js';

export interface HttpSecurityBoundaryOptions {
  bearerToken: string;
}

export function createHttpSecurityBoundary(options: HttpSecurityBoundaryOptions): MiddlewareHandler<Env> {
  return async (context, next) => {
    if (isPublicApiException(context.req.raw)) {
      await next();
      return;
    }

    const authorization = context.req.header('Authorization');
    if (authorization !== `Bearer ${options.bearerToken}`) {
      return bearerRequired(context);
    }

    await next();
  };
}

export function bearerRequired(context: Context<Env, string>): Response {
  return context.json({
    ok: false,
    code: LINNSY_ERROR_CODES.HTTP_BEARER_REQUIRED
  }, 401);
}

function isPublicApiException(request: Request): boolean {
  if (request.method === 'OPTIONS') {
    return true;
  }

  const url = new URL(request.url);
  return request.method === 'GET' && url.pathname === '/api/v1/stream';
}
