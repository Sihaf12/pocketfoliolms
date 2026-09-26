/**
 * Studio sessions. Stored in app.sessions like a learner's, but with
 * kind 'studio', an eight-hour life, and their own cookie, so neither
 * kind of session is ever read as the other.
 *
 * A session only counts while its user still holds a studio role:
 * removing someone's roles ends their studio access at once.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { ScopedDb } from '../db/unitOfWork.js';

export const STUDIO_COOKIE = 'studio_session';
export const STUDIO_SESSION_SECONDS = 8 * 60 * 60;

export const STUDIO_ROLES = ['author', 'reviewer', 'compliance', 'tenant_admin'] as const;
export type StudioRole = (typeof STUDIO_ROLES)[number];

export interface StudioUser {
  id: string;
  email: string;
  displayName: string;
  roles: StudioRole[];
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest();

export async function issueStudioSession(db: ScopedDb, userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const row = await db.maybeOne<{ id: string }>(
    `INSERT INTO app.sessions (tenant_id, user_id, token_hash, expires_at, kind)
     SELECT u.tenant_id, u.id, $2, now() + make_interval(secs => $3), 'studio'
       FROM app.users u
      WHERE u.id = $1 AND cardinality(u.studio_roles) > 0
     RETURNING id`,
    [userId, hashToken(token), STUDIO_SESSION_SECONDS],
  );
  if (!row) throw new Error('cannot issue a studio session for this user');
  return token;
}

export async function readStudioSession(db: ScopedDb, token: string | undefined): Promise<StudioUser | null> {
  if (!token) return null;
  return db.maybeOne<StudioUser>(
    `SELECT u.id, u.email, u.display_name AS "displayName", u.studio_roles AS roles
       FROM app.sessions s
       JOIN app.users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.kind = 'studio'
        AND s.revoked_at IS NULL AND s.expires_at > now()
        AND cardinality(u.studio_roles) > 0`,
    [hashToken(token)],
  );
}

export async function revokeStudioSession(db: ScopedDb, token: string): Promise<void> {
  await db.query(
    `UPDATE app.sessions SET revoked_at = now() WHERE token_hash = $1 AND kind = 'studio' AND revoked_at IS NULL`,
    [hashToken(token)],
  );
}

export async function revokeAllStudioSessions(db: ScopedDb, userId: string): Promise<void> {
  await db.query(
    `UPDATE app.sessions SET revoked_at = now() WHERE user_id = $1 AND kind = 'studio' AND revoked_at IS NULL`,
    [userId],
  );
}
