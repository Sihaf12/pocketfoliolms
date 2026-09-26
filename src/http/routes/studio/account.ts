/**
 * Studio sign-in, sign-out, who am I, and accepting an invitation.
 *
 * Only people holding at least one studio role can sign in here. A
 * learner's email and password get the same refusal as a wrong password,
 * so the studio does not reveal who works at an academy.
 *
 * An invitation belongs to one academy and works only on its host: the
 * lookup runs under that academy's RLS. It is single use, and expires
 * 72 hours after it was made.
 */
import type { FastifyInstance } from 'fastify';
import { hashPassword, verifyPassword } from '../../../auth/password.js';
import {
  hashToken, issueStudioSession, revokeStudioSession, STUDIO_COOKIE, type StudioRole,
} from '../../../auth/studioSession.js';
import { HttpError } from '../../errors.js';
import { clearStudioCookie, inStudio, requireStudio, setStudioCookie } from '../../studioScope.js';
import type { RouteLimit } from '../../server.js';

export const studioUserSchema = {
  type: 'object',
  required: ['id', 'email', 'displayName', 'roles'],
  properties: {
    id: { type: 'string' },
    email: { type: 'string' },
    displayName: { type: 'string' },
    roles: { type: 'array', items: { type: 'string' } },
  },
} as const;

const userEnvelope = { type: 'object', required: ['user'], properties: { user: studioUserSchema } } as const;
const email = { type: 'string', format: 'email', maxLength: 254 } as const;
const normaliseEmail = (value: string) => value.trim().toLowerCase();

export async function studioAccountRoutes(app: FastifyInstance, opts: { loginLimit: RouteLimit }): Promise<void> {
  app.post<{ Body: { email: string; password: string } }>('/auth/login', {
    config: { rateLimit: { max: opts.loginLimit.max, timeWindow: opts.loginLimit.windowMs } },
    schema: {
      body: {
        type: 'object', additionalProperties: false, required: ['email', 'password'],
        properties: { email, password: { type: 'string', minLength: 1, maxLength: 200 } },
      },
      response: { 200: userEnvelope },
    },
  }, async (req, reply) => {
    const { user, token } = await inStudio(req, async (db) => {
      const row = await db.maybeOne<{ id: string; email: string; displayName: string; roles: StudioRole[]; passwordHash: string | null }>(
        `SELECT id, email, display_name AS "displayName", studio_roles AS roles, password_hash AS "passwordHash"
           FROM app.users WHERE email = $1`,
        [normaliseEmail(req.body.email)],
      );
      const ok = await verifyPassword(req.body.password, row?.passwordHash ?? null);
      if (!row || !ok || row.roles.length === 0) {
        throw new HttpError(401, 'invalid_credentials', 'Email or password is incorrect.');
      }
      const { passwordHash: _omit, ...user } = row;
      await db.query(`SELECT set_config('app.actor', $1, true)`, [user.id]);
      await db.audit({ action: 'studio.signed_in', entityType: 'user', entityId: user.id });
      return { user, token: await issueStudioSession(db, user.id) };
    });
    setStudioCookie(reply, token);
    return reply.send({ user });
  });

  app.post('/auth/logout', async (req, reply) => {
    const token = req.cookies[STUDIO_COOKIE];
    if (token) await inStudio(req, (db) => revokeStudioSession(db, token));
    clearStudioCookie(reply);
    return reply.status(204).send();
  });

  app.get('/me', {
    schema: {
      response: {
        200: {
          type: 'object',
          required: ['user', 'academy', 'reviewSignoffs'],
          properties: {
            user: studioUserSchema,
            academy: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
            reviewSignoffs: { type: 'integer' },
          },
        },
      },
    },
  }, async (req) =>
    inStudio(req, async (db) => {
      const user = await requireStudio(db, req);
      const academy = await db.one<{ name: string }>('SELECT name FROM app.current_tenant_brand()');
      const settings = await db.maybeOne<{ reviewSignoffs: number }>(
        'SELECT review_signoffs AS "reviewSignoffs" FROM app.tenant_settings');
      return { user, academy, reviewSignoffs: settings?.reviewSignoffs ?? 2 };
    }));

  app.post<{ Body: { token: string; password: string; displayName?: string } }>('/invitations/accept', {
    config: { rateLimit: { max: opts.loginLimit.max, timeWindow: opts.loginLimit.windowMs } },
    schema: {
      body: {
        type: 'object', additionalProperties: false, required: ['token', 'password'],
        properties: {
          token: { type: 'string', minLength: 20, maxLength: 200 },
          password: { type: 'string', minLength: 1, maxLength: 200 },
          displayName: { type: 'string', minLength: 1, maxLength: 100 },
        },
      },
      response: { 201: userEnvelope },
    },
  }, async (req, reply) => {
    const { token, password, displayName } = req.body;
    // Hashed before the transaction opens: it is the slow part, and only
    // used if this invitation creates a new account.
    const newHash = password.length >= 12 ? await hashPassword(password) : null;

    const { user, session } = await inStudio(req, async (db) => {
      // Claimed and checked in one statement, so two tabs cannot both use it.
      const invitation = await db.maybeOne<{ id: string; email: string; roles: StudioRole[] }>(
        `UPDATE app.studio_invitations SET accepted_at = now()
          WHERE token_hash = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
          RETURNING id, email, roles`,
        [hashToken(token)],
      );
      if (!invitation) {
        throw new HttpError(404, 'invitation_invalid', 'This invitation has expired, been used, or is not for this academy.');
      }

      const existing = await db.maybeOne<{ id: string; passwordHash: string | null }>(
        'SELECT id, password_hash AS "passwordHash" FROM app.users WHERE email = $1',
        [invitation.email],
      );
      let userId: string;
      if (existing) {
        // Someone who already has an account here proves it is theirs.
        if (!(await verifyPassword(password, existing.passwordHash))) {
          throw new HttpError(401, 'invalid_credentials', 'Use the password you already have at this academy.');
        }
        await db.query(
          `UPDATE app.users SET studio_roles = ARRAY(SELECT DISTINCT unnest(studio_roles || $2::text[]) ORDER BY 1)
            WHERE id = $1`,
          [existing.id, invitation.roles],
        );
        userId = existing.id;
      } else {
        if (!newHash) throw new HttpError(400, 'invalid_request', 'Choose a password of at least 12 characters.');
        if (!displayName) throw new HttpError(400, 'invalid_request', 'Tell us the name to show on your work.');
        const created = await db.one<{ id: string }>(
          `INSERT INTO app.users (tenant_id, email, display_name, password_hash, studio_roles)
           VALUES (app.current_tenant(), $1, $2, $3, $4::text[]) RETURNING id`,
          [invitation.email, displayName, newHash, invitation.roles],
        );
        userId = created.id;
      }

      await db.query(`SELECT set_config('app.actor', $1, true)`, [userId]);
      await db.audit({
        action: 'studio.invitation_accepted', entityType: 'invitation', entityId: invitation.id,
        payload: { user_id: userId, roles: invitation.roles, existing_account: existing !== null },
      });
      const user = await db.one<{ id: string; email: string; displayName: string; roles: StudioRole[] }>(
        `SELECT id, email, display_name AS "displayName", studio_roles AS roles FROM app.users WHERE id = $1`, [userId]);
      return { user, session: await issueStudioSession(db, userId) };
    });

    setStudioCookie(reply, session);
    return reply.status(201).send({ user });
  });
}
