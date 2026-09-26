/**
 * Who is asking, and at which host. Decided once, before anything else.
 *
 * The Next.js front end forwards browser requests here with the public
 * host in X-Forwarded-Host, the browser's address in X-Forwarded-For,
 * and a shared secret in X-Academy-Proxy-Secret. Forwarded headers are
 * believed only when that secret is present and correct. A request that
 * carries any X-Forwarded-* header without it is refused outright,
 * rather than having the headers quietly ignored, so a misconfigured
 * proxy fails loudly instead of routing every learner to one academy.
 *
 * Without forwarding, the Host header is the public host and the socket
 * address is the client.
 */
import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { HttpError } from './errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** The host the browser asked for. Not yet normalised. */
    publicHost: string;
    /** The browser's address, for rate limits. */
    clientIp: string;
  }
}

export const SECRET_HEADER = 'x-academy-proxy-secret';
const FORWARDED = ['x-forwarded-host', 'x-forwarded-for', 'x-forwarded-proto', 'forwarded'] as const;

const first = (value: string | string[] | undefined): string | undefined => {
  const v = Array.isArray(value) ? value[0] : value;
  return v?.split(',')[0]?.trim() || undefined;
};

function secretMatches(presented: string, secret: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function forwarding(app: FastifyInstance, secret: string): void {
  app.decorateRequest('publicHost', '');
  app.decorateRequest('clientIp', '');

  app.addHook('onRequest', async (req: FastifyRequest) => {
    const presented = req.headers[SECRET_HEADER];
    const forwarded = FORWARDED.some((h) => req.headers[h] !== undefined);
    const socketIp = req.socket.remoteAddress ?? '';

    if (presented === undefined && !forwarded) {
      req.publicHost = req.headers.host ?? '';
      req.clientIp = socketIp;
      return;
    }
    if (!secret || typeof presented !== 'string' || !secretMatches(presented, secret)) {
      throw new HttpError(400, 'forwarding_refused', 'Forwarded requests are accepted only from the academy front end.');
    }
    req.publicHost = first(req.headers['x-forwarded-host']) ?? req.headers.host ?? '';
    req.clientIp = first(req.headers['x-forwarded-for']) ?? socketIp;
  });
}
