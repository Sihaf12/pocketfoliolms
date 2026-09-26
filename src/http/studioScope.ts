/**
 * The academy studio, at /api/studio on the academy's own host. It sits
 * inside the tenant scope, so the host has already decided the academy.
 * What it adds:
 *
 *   a studio session, in its own cookie, never read as a learner's
 *   a role check on every route, against the set of roles a user holds
 *   the app_studio database role, which may write this academy's content
 *   the same-origin check on every write
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { withStudio, type ScopedDb } from '../db/unitOfWork.js';
import {
  readStudioSession, STUDIO_COOKIE, STUDIO_SESSION_SECONDS, type StudioRole, type StudioUser,
} from '../auth/studioSession.js';
import { HttpError } from './errors.js';
import { sameOrigin } from './sameOrigin.js';

export function studioScope(scope: FastifyInstance): void {
  sameOrigin(scope);
}

export function inStudio<T>(req: FastifyRequest, fn: (db: ScopedDb) => Promise<T>): Promise<T> {
  return withStudio({ tenantId: req.tenantId, actor: 'studio' }, fn);
}

/**
 * The studio user behind this request, holding at least one of `anyOf`
 * if given. Records them as the actor for the rest of the transaction.
 */
export async function requireStudio(db: ScopedDb, req: FastifyRequest, anyOf?: readonly StudioRole[]): Promise<StudioUser> {
  const user = await readStudioSession(db, req.cookies[STUDIO_COOKIE]);
  if (!user) throw new HttpError(401, 'unauthenticated', 'Sign in to the studio to continue.');
  if (anyOf && !anyOf.some((r) => user.roles.includes(r))) {
    throw new HttpError(403, 'forbidden', 'Your studio roles do not include this.');
  }
  await db.query(`SELECT set_config('app.actor', $1, true)`, [user.id]);
  return user;
}

// Strict: the studio is never entered from a link on another site.
const cookieOptions = (reply: FastifyReply) =>
  ({ path: '/', httpOnly: true, secure: reply.server.sessionCookieSecure, sameSite: 'strict' }) as const;

export function setStudioCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(STUDIO_COOKIE, token, { ...cookieOptions(reply), maxAge: STUDIO_SESSION_SECONDS });
}

export function clearStudioCookie(reply: FastifyReply): void {
  reply.clearCookie(STUDIO_COOKIE, cookieOptions(reply));
}
