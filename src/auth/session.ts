/**
 * Login sessions, stored in app.sessions under RLS.
 *
 * The token is 32 random bytes held by the client in a host-only cookie;
 * the database keeps only its SHA-256. Every read happens inside the
 * request's unit of work, so a token issued at one academy is simply not
 * there when read under another. No tenant id travels with the token.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { ScopedDb } from '../db/unitOfWork.js';

export const SESSION_COOKIE = 'session';
export const SESSION_TTL_SECONDS = 14 * 24 * 60 * 60;

export type Lifecycle =
  'registered' | 'onboarded' | 'placed' | 'activated' | 'active' | 'certified' | 'dormant';

export interface Learner {
  id: string;
  email: string;
  displayName: string;
  lifecycle: Lifecycle;
  ibRefCode: string | null;
}

const hashToken = (token: string) => createHash('sha256').update(token).digest();

export async function issueSession(db: ScopedDb, userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  // The tenant is copied from the user row as this academy sees it, so a
  // user id from any other academy inserts nothing.
  const row = await db.maybeOne<{ id: string }>(
    `INSERT INTO app.sessions (tenant_id, user_id, token_hash, expires_at)
     SELECT u.tenant_id, u.id, $2, now() + make_interval(secs => $3)
       FROM app.users u
      WHERE u.id = $1
     RETURNING id`,
    [userId, hashToken(token), SESSION_TTL_SECONDS],
  );
  if (!row) throw new Error('cannot issue a session for a user outside this academy');
  return token;
}

export async function readSession(db: ScopedDb, token: string | undefined): Promise<Learner | null> {
  if (!token) return null;
  return db.maybeOne<Learner>(
    `SELECT u.id, u.email, u.display_name AS "displayName", u.lifecycle, u.ib_ref_code AS "ibRefCode"
       FROM app.sessions s
       JOIN app.users u ON u.id = s.user_id
      WHERE s.token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > now()`,
    [hashToken(token)],
  );
}

export async function revokeSession(db: ScopedDb, token: string): Promise<void> {
  await db.query(
    'UPDATE app.sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL',
    [hashToken(token)],
  );
}
