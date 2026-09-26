/**
 * Who is asking, and at which host. Decided once, before anything else.
 *
 * The Next.js front end forwards browser requests here with the public
 * host in X-Forwarded-Host, the browser's address in X-Forwarded-For,
 * and a shared secret in X-Academy-Proxy-Secret.
 *
 *   the right secret     forwarded headers are believed
 *   a wrong secret       the request is refused: something is presenting
 *                        itself as the front end and is not
 *   no secret at all     forwarded headers are ignored, as a load balancer
 *                        in front may add them; the Host header and the
 *                        socket address decide, and a warning is logged
 *                        once per process so the setup can be put right
 */
import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { logger } from '../logger.js';
import { HttpError } from './errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** The host the browser asked for. Not yet normalised. */
    publicHost: string;
    /** The browser's address, for rate limits. */
    clientIp: string;
    /** The scheme the browser used, for links the server writes. */
    publicProto: 'http' | 'https';
  }
}

export const SECRET_HEADER = 'x-academy-proxy-secret';
const FORWARDED = ['x-forwarded-host', 'x-forwarded-for', 'x-forwarded-proto', 'forwarded'] as const;

const first = (value: string | string[] | undefined): string | undefined => {
  const v = Array.isArray(value) ? value[0] : value;
  return v?.split(',')[0]?.trim() || undefined;
};

let warnedUnsigned = false;

/** For tests: the next unsigned forwarded request logs its warning again. */
export function forgetForwardingWarning(): void {
  warnedUnsigned = false;
}

function secretMatches(presented: string, secret: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function forwarding(app: FastifyInstance, secret: string): void {
  app.decorateRequest('publicHost', '');
  app.decorateRequest('clientIp', '');
  app.decorateRequest('publicProto', 'http');

  app.addHook('onRequest', async (req: FastifyRequest) => {
    const presented = req.headers[SECRET_HEADER];
    const forwarded = FORWARDED.some((h) => req.headers[h] !== undefined);
    const socketIp = req.socket.remoteAddress ?? '';

    if (presented === undefined) {
      if (forwarded && !warnedUnsigned) {
        warnedUnsigned = true;
        logger.warn({ headers: FORWARDED.filter((h) => req.headers[h] !== undefined) },
          'forwarded headers arrived without the front end\'s secret and were ignored; the Host header and socket address decide');
      }
      req.publicHost = req.headers.host ?? '';
      req.clientIp = socketIp;
      req.publicProto = req.protocol === 'https' ? 'https' : 'http';
      return;
    }
    if (!secret || typeof presented !== 'string' || !secretMatches(presented, secret)) {
      throw new HttpError(400, 'forwarding_refused', 'Forwarded requests are accepted only from the academy front end.');
    }
    req.publicHost = first(req.headers['x-forwarded-host']) ?? req.headers.host ?? '';
    req.clientIp = first(req.headers['x-forwarded-for']) ?? socketIp;
    req.publicProto = first(req.headers['x-forwarded-proto']) === 'https' ? 'https' : 'http';
  });
}
