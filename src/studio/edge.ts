/**
 * What the front end's edge server believes about a request, before
 * Next.js sees it. Kept apart from server.ts so it can be tested without
 * starting Next.
 *
 *   no proxy secret      nothing in front: every forwarded header a
 *                        client sent is dropped, and the socket's address
 *                        is the client's
 *   the right secret     the reverse proxy in front (Caddy) sent it: its
 *                        X-Forwarded-For names the client. Caddy replaces
 *                        any X-Forwarded-For a client sent, so the first
 *                        entry is the one it saw
 *   a wrong secret       refused: something is presenting itself as the
 *                        proxy and is not
 *
 * The secret header never reaches Next.js.
 */
import { timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

export const EDGE_SECRET_HEADER = 'x-academy-proxy-secret';
const FORWARDED = ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-port', 'forwarded', 'x-real-ip'];

export interface EdgeRequest {
  headers: IncomingHttpHeaders;
  socket: { remoteAddress?: string | undefined };
}

const firstOf = (value: string | string[] | undefined): string | undefined => {
  const v = Array.isArray(value) ? value[0] : value;
  return v?.split(',')[0]?.trim() || undefined;
};

function matches(presented: string, secret: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Rewrites the request's forwarded headers to the one address this edge
 * believes. False when the request must be refused.
 */
export function admit(req: EdgeRequest, secret: string): boolean {
  const presented = req.headers[EDGE_SECRET_HEADER];
  const proxied = firstOf(req.headers['x-forwarded-for']);
  for (const h of [...FORWARDED, EDGE_SECRET_HEADER]) delete req.headers[h];
  const socket = req.socket.remoteAddress ?? '';

  if (presented === undefined) {
    req.headers['x-forwarded-for'] = socket;
    return true;
  }
  if (!secret || typeof presented !== 'string' || !matches(presented, secret)) return false;
  req.headers['x-forwarded-for'] = proxied ?? socket;
  return true;
}

/** Answered by the edge itself: the process is up. No database, no Next.js. */
export const isHealthCheck = (url: string | undefined) => url === '/healthz';
