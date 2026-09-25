/**
 * The tenant scope. Every route registered inside it serves exactly one
 * academy, and the only input to that decision is the request host,
 * matched against app.tenants.primary_domain by the database.
 *
 * Nothing the client sends in a body, query, cookie or custom header can
 * choose the tenant. X-Forwarded-Host is honoured only when the server is
 * built with trustProxy naming the proxy it came through.
 *
 * An unknown, malformed or suspended host is a 404. There is no default
 * academy to fall back to.
 */
import type { FastifyInstance } from 'fastify';
import { resolveTenantByHost } from '../db/unitOfWork.js';
import { HttpError } from './errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Decided from the host by the tenant scope. Empty outside it. */
    tenantId: string;
  }
}

const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const HOSTNAME = new RegExp(`^(?=.{1,253}$)${LABEL}(?:\\.${LABEL})+$`);

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

// Only hits are cached, so a new academy works at once and the map is
// bounded by the number of academies. Provisioning clears it when a
// domain moves or an academy is suspended.
const CACHE_TTL_MS = 30_000;
const resolved = new Map<string, { tenantId: string; until: number }>();

export function forgetResolvedHosts(): void {
  resolved.clear();
}

async function tenantFor(host: string): Promise<string | null> {
  const hit = resolved.get(host);
  if (hit && hit.until > Date.now()) return hit.tenantId;
  const tenantId = await resolveTenantByHost(host);
  if (tenantId) resolved.set(host, { tenantId, until: Date.now() + CACHE_TTL_MS });
  else resolved.delete(host);
  return tenantId;
}

export function tenantScope(scope: FastifyInstance): void {
  scope.decorateRequest('tenantId', '');

  scope.addHook('onRequest', async (req) => {
    const host = normaliseHost(req.host);
    const tenantId = host ? await tenantFor(host) : null;
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
