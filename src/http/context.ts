/**
 * What a tenant route handler works with: one unit of work for the
 * academy the host resolved to, and the learner behind the session cookie
 * as that academy sees it.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { withTenant, type ScopedDb } from '../db/unitOfWork.js';
import { readSession, SESSION_COOKIE, SESSION_TTL_SECONDS, type Learner } from '../auth/session.js';
import type { TierScores } from '../domain/placement.js';
import { HttpError } from './errors.js';

export function inAcademy<T>(req: FastifyRequest, fn: (db: ScopedDb) => Promise<T>): Promise<T> {
  return withTenant({ tenantId: req.tenantId, actor: 'http' }, fn);
}

/** Read inside the route's own transaction, so the session and the work share one tenant. */
export async function requireLearner(db: ScopedDb, req: FastifyRequest): Promise<Learner> {
  const learner = await readSession(db, req.cookies[SESSION_COOKIE]);
  if (!learner) throw new HttpError(401, 'unauthenticated', 'Sign in to continue.');
  return learner;
}

const NOT_YET_PLACED = new Set(['registered', 'onboarded']);

/** The learner's baseline, for routes that only make sense after placement. */
export async function requirePlacement(db: ScopedDb, learner: Learner): Promise<TierScores> {
  if (NOT_YET_PLACED.has(learner.lifecycle)) {
    throw new HttpError(409, 'placement_required', 'Take placement to open your pathway.');
  }
  const path = await db.one<{ baseline: TierScores }>(
    'SELECT baseline FROM app.learning_paths WHERE user_id = $1',
    [learner.id],
  );
  return path.baseline;
}

// No Domain attribute: the cookie is host-only, so the browser never
// sends one academy's session to another academy's domain.
const COOKIE_OPTIONS = { path: '/', httpOnly: true, secure: true, sameSite: 'lax' } as const;

export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(SESSION_COOKIE, token, { ...COOKIE_OPTIONS, maxAge: SESSION_TTL_SECONDS });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, COOKIE_OPTIONS);
}
