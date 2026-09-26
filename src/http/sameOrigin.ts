/**
 * Cross-site request refusal for the studio and the console. Their
 * cookies are SameSite=Strict already; this is the second lock. A write
 * whose Origin names another host, or that the browser marks as
 * cross-site, is refused before it reaches a handler.
 */
import type { FastifyInstance } from 'fastify';
import { HttpError } from './errors.js';
import { normaliseHost } from './tenantScope.js';

const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function sameOrigin(scope: FastifyInstance): void {
  scope.addHook('onRequest', async (req) => {
    if (!WRITES.has(req.method)) return;
    if (req.headers['sec-fetch-site'] === 'cross-site') {
      throw new HttpError(403, 'cross_site_refused', 'This change has to come from this site.');
    }
    const origin = req.headers.origin;
    if (origin === undefined) return;
    let originHost: string | null = null;
    try { originHost = normaliseHost(new URL(origin).host); } catch { originHost = null; }
    if (!originHost || originHost !== normaliseHost(req.publicHost)) {
      throw new HttpError(403, 'cross_site_refused', 'This change has to come from this site.');
    }
  });
}

/** The scheme the browser used: forwarded by the front end, or this socket's. */
export function publicOrigin(req: { headers: Record<string, string | string[] | undefined>; protocol: string; publicHost: string }): string {
  const forwarded = req.headers['x-forwarded-proto'];
  const proto = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim() || req.protocol;
  return `${proto === 'https' ? 'https' : 'http'}://${req.publicHost}`;
}
