/**
 * Platform staff sessions, on the console host only. Eight hours. A
 * session records whether its sign-in passed TOTP; the owner's always has.
 */
import { randomBytes } from 'node:crypto';
import type { ConsoleDb } from '../db/unitOfWork.js';
import { hashToken } from './studioSession.js';

export const CONSOLE_COOKIE = 'console_session';
export const STAFF_SESSION_SECONDS = 8 * 60 * 60;

export type StaffRole = 'platform_owner' | 'platform_author' | 'platform_reviewer' | 'platform_compliance';

export interface Staff {
  id: string;
  email: string;
  displayName: string;
  role: StaffRole;
}

export async function issueStaffSession(db: ConsoleDb, staffId: string, mfa: boolean): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.query(
    `INSERT INTO platform.staff_sessions (staff_id, token_hash, expires_at, mfa_verified_at)
     VALUES ($1, $2, now() + make_interval(secs => $3), CASE WHEN $4 THEN now() END)`,
    [staffId, hashToken(token), STAFF_SESSION_SECONDS, mfa],
  );
  return token;
}

export async function readStaffSession(db: ConsoleDb, token: string | undefined): Promise<Staff | null> {
  if (!token) return null;
  return db.maybeOne<Staff>(
    `SELECT st.id, st.email, st.display_name AS "displayName", st.role
       FROM platform.staff_sessions s
       JOIN platform.staff st ON st.id = s.staff_id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
        AND st.disabled_at IS NULL
        AND (st.role <> 'platform_owner' OR s.mfa_verified_at IS NOT NULL)`,
    [hashToken(token)],
  );
}

export async function revokeStaffSession(db: ConsoleDb, token: string): Promise<void> {
  await db.query(
    'UPDATE platform.staff_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL',
    [hashToken(token)],
  );
}
