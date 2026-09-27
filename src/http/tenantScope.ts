/**
 * The tenant scope. Every route registered inside it serves exactly one
 * academy, and the only input to that decision is the request host,
 * matched against app.tenants.primary_domain by the database.
 *
 * Nothing the client sends in a body, query, cookie or custom header can
 * choose the tenant. The host is the one forwarding.ts decided: the Host
 * header, or X-Forwarded-Host when it came with the front end's secret.
 * The console's host is never an academy, whatever the database says.
 *
 * An unknown, malformed or suspended host is a 404. There is no default
 * academy to fall back to.
 *
 * Every request is counted against a per-IP limit before the host is
 * resolved, so a spray of made-up hosts is turned away without reaching
 * the database, and an unknown host is remembered for a few seconds.
 */
import type { FastifyInstance } from 'fastify';
import { resolveTenantByHost } from '../db/unitOfWork.js';
import { HttpError } from './errors.js';
import type { RouteLimit } from './server.js';
import { HOSTNAME } from '../../packages/shared/names.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Decided from the host by the tenant scope. Empty outside it. */
    tenantId: string;
  }
}


/** Lowercase, no port, no trailing dot, and shaped like a DNS name; otherwise null. */
export function normaliseHost(raw: string | undefined): string | null {
  if (!raw) return null;
  let host = raw.trim().toLowerCase();
  // An IP literal never names an academy.
  if (host.startsWith('[')) return null;
  const colon = host.lastIndexOf(':');
  if (colon !== -1) {
    if (!/^\d{1,5}$/.test(host.slice(colon + 1))) return null;
    host = host.slice(0, colon);
  }
  if (host.endsWith('.')) host = host.slice(0, -1);
  return HOSTNAME.test(host) ? host : null;
}

// Hits are bounded by the number of academies. Misses are remembered
// briefly and capped, oldest first, so a flood of made-up hosts can
// neither reach the database each time nor grow this map without end.
// The cost: a newly provisioned academy may wait up to MISS_TTL_MS.
// Provisioning clears both when a domain moves or an academy changes status.
const HIT_TTL_MS = 30_000;
const MISS_TTL_MS = 5_000;
const MISS_CAPACITY = 10_000;
const resolved = new Map<string, { tenantId: string; until: number }>();
const unknown = new Map<string, number>();

export function forgetResolvedHosts(): void {
  resolved.clear();
  unknown.clear();
}

function rememberMiss(host: string, now: number): void {
  unknown.delete(host);
  if (unknown.size >= MISS_CAPACITY) {
    const oldest = unknown.keys().next().value;
    if (oldest !== undefined) unknown.delete(oldest);
  }
  unknown.set(host, now + MISS_TTL_MS);
}

/** The active academy at this host, through the same short-lived cache the tenant scope uses. */
export async function tenantFor(host: string): Promise<string | null> {
  const now = Date.now();
  const hit = resolved.get(host);
  if (hit && hit.until > now) return hit.tenantId;
  const missUntil = unknown.get(host);
  if (missUntil !== undefined && missUntil > now) return null;

  const tenantId = await resolveTenantByHost(host);
  if (tenantId) {
    resolved.set(host, { tenantId, until: now + HIT_TTL_MS });
    unknown.delete(host);
  } else {
    resolved.delete(host);
    rememberMiss(host, now);
  }
  return tenantId;
}

export function tenantScope(scope: FastifyInstance, opts: { limit: RouteLimit; consoleHost: string }): void {
  scope.decorateRequest('tenantId', '');

  // createRateLimit rather than a rateLimit hook: the plugin lets only one
  // of its hooks run per request, and a scope-wide hook would silently
  // switch off the stricter per-route limit on login.
  const allow = scope.createRateLimit({ max: opts.limit.max, timeWindow: opts.limit.windowMs });

  // Registered first, so it runs before resolution touches the database.
  scope.addHook('onRequest', async (req, reply) => {
    // isAllowed means allow-listed; isExceeded is the over-the-limit signal.
    const verdict = await allow(req);
    if (!verdict.isAllowed && verdict.isExceeded) {
      reply.header('retry-after', String(verdict.ttlInSeconds));
      throw new HttpError(429, 'rate_limited', `Too many requests. Try again in ${verdict.ttlInSeconds} seconds.`);
    }
  });

  scope.addHook('onRequest', async (req) => {
    const host = normaliseHost(req.publicHost);
    const tenantId = host && host !== opts.consoleHost ? await tenantFor(host) : null;
    if (!tenantId) throw new HttpError(404, 'unknown_academy', 'No academy is served at this address.');
    req.tenantId = tenantId;
  });

  // Tenant responses are per learner and per academy. No shared cache may
  // hold one, or academy A's page could be served on academy B's domain.
  scope.addHook('onSend', async (_req, reply) => {
    reply.header('cache-control', 'private, no-store');
    reply.header('vary', 'Host, Cookie');
  });
}
