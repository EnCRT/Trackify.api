/**
 * request-context middleware — C-07.
 *
 * - Assigns/propagates X-Request-Id for end-to-end tracing (echoed in the
 *   response header and attached to ctx.state for structured logs).
 * - Optional force-upgrade: if MIN_CLIENT_VERSION is set and the caller's
 *   X-Client-Version is older, respond 426 Upgrade Required.
 *
 * Registered in config/middlewares.ts as 'global::request-context'.
 */

import type { Core } from '@strapi/strapi';
import { randomUUID } from 'node:crypto';

/** Returns true if semver `a` is strictly older than `b` (numeric compare). */
function isVersionLess(a: string, b: string): boolean {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x < y) return true;
    if (x > y) return false;
  }
  return false;
}

const middleware: Core.MiddlewareFactory = (_config, { strapi }) => {
  const minClientVersion = process.env.MIN_CLIENT_VERSION;

  return async (ctx, next) => {
    const requestId =
      (ctx.request.header['x-request-id'] as string) || randomUUID();
    ctx.state.requestId = requestId;
    ctx.set('X-Request-Id', requestId);

    const clientVersion = ctx.request.header['x-client-version'] as string | undefined;

    if (minClientVersion && clientVersion && isVersionLess(clientVersion, minClientVersion)) {
      strapi.log.info(
        `[request-context] 426 upgrade required: client ${clientVersion} < min ${minClientVersion} (req ${requestId})`
      );
      ctx.status = 426;
      ctx.body = {
        data: null,
        error: {
          status: 426,
          name: 'UpgradeRequiredError',
          message: `Client version ${clientVersion} is below the minimum supported ${minClientVersion}. Please update the app.`,
          details: { min_client_version: minClientVersion },
        },
      };
      return;
    }

    await next();
  };
};

export default middleware;
