/**
 * The platform console, at /api/console, answering on one host only.
 *
 * The host check comes first: on any host other than CONSOLE_HOST these
 * routes answer a plain 404, as if they did not exist. The console never
 * runs tenant resolution, and the tenant scope treats the console host
 * as no academy, so the two cannot be reached through each other.
 *
 * Every write passes the same-origin check, responses are uncacheable,
 * and work runs as app_console, which cannot read learner data.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { withConsole, type ConsoleDb } from '../db/unitOfWork.js';
import { CONSOLE_COOKIE, readStaffSession, STAFF_SESSION_SECONDS, type Staff, type StaffRole } from '../auth/staffSession.js';
import { HttpError } from './errors.js';
import { sameOrigin } from './sameOrigin.js';
import { normaliseHost } from './tenantScope.js';
import type { RouteLimit } from './server.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** The key TOTP secrets are sealed with. Present only when the console is enabled. */
    totpKey: Buffer;
  }
}

export function consoleScope(scope: FastifyInstance, opts: { host: string; limit: RouteLimit }): void {
  scope.addHook('onRequest', async (req) => {
    if (normaliseHost(req.publicHost) !== opts.host) throw new HttpError(404, 'not_found', 'Not found.');
  });

  const allow = scope.createRateLimit({ max: opts.limit.max, timeWindow: opts.limit.windowMs });
  scope.addHook('onRequest', async (req, reply) => {
    const verdict = await allow(req);
    if (!verdict.isAllowed && verdict.isExceeded) {
      reply.header('retry-after', String(verdict.ttlInSeconds));
      throw new HttpError(429, 'rate_limited', `Too many requests. Try again in ${verdict.ttlInSeconds} seconds.`);
    }
  });

  sameOrigin(scope);

  scope.addHook('onSend', async (_req, reply) => {
    reply.header('cache-control', 'private, no-store');
  });
}

export function inConsole<T>(fn: (db: ConsoleDb) => Promise<T>): Promise<T> {
  return withConsole({ actor: 'console' }, fn);
}

/** The staff member behind this request, in one of `anyOf` if given. */
export async function requireStaff(db: ConsoleDb, req: FastifyRequest, anyOf?: readonly StaffRole[]): Promise<Staff> {
  const staff = await readStaffSession(db, req.cookies[CONSOLE_COOKIE]);
  if (!staff) throw new HttpError(401, 'unauthenticated', 'Sign in to the console to continue.');
  if (anyOf && !anyOf.includes(staff.role)) throw new HttpError(403, 'forbidden', 'Your role does not include this.');
  await db.query(`SELECT set_config('app.actor', $1, true)`, [`staff:${staff.id}`]);
  return staff;
}

const cookieOptions = (reply: FastifyReply) =>
  ({ path: '/', httpOnly: true, secure: reply.server.sessionCookieSecure, sameSite: 'strict' }) as const;

export function setConsoleCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(CONSOLE_COOKIE, token, { ...cookieOptions(reply), maxAge: STAFF_SESSION_SECONDS });
}

export function clearConsoleCookie(reply: FastifyReply): void {
  reply.clearCookie(CONSOLE_COOKIE, cookieOptions(reply));
}
