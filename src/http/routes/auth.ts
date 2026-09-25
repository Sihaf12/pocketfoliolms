/**
 * Sign-up, login and logout.
 *
 * Accounts belong to one academy: the same email at two academies is two
 * unrelated accounts, and nothing here can tell a learner, or a broker,
 * that the other exists.
 */
import type { FastifyInstance } from 'fastify';
import { hashPassword, verifyPassword } from '../../auth/password.js';
import { issueSession, revokeSession, SESSION_COOKIE, type Lifecycle } from '../../auth/session.js';
import { clearSessionCookie, inAcademy, setSessionCookie } from '../context.js';
import { HttpError } from '../errors.js';

interface User {
  id: string;
  email: string;
  displayName: string;
  lifecycle: Lifecycle;
}

const USER_COLUMNS = `id, email, display_name AS "displayName", lifecycle`;

// Response schemas also filter: a field not listed here is never sent.
const userEnvelope = {
  type: 'object',
  required: ['user'],
  properties: {
    user: {
      type: 'object',
      required: ['id', 'email', 'displayName', 'lifecycle'],
      properties: {
        id: { type: 'string' },
        email: { type: 'string' },
        displayName: { type: 'string' },
        lifecycle: { type: 'string' },
      },
    },
  },
} as const;

const email = { type: 'string', format: 'email', maxLength: 254 } as const;

interface SignupBody {
  email: string;
  password: string;
  displayName: string;
  locale?: string;
  ibRefCode?: string;
}

interface LoginBody {
  email: string;
  password: string;
}

const normaliseEmail = (value: string) => value.trim().toLowerCase();

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: SignupBody }>('/auth/signup', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['email', 'password', 'displayName'],
        properties: {
          email,
          password: { type: 'string', minLength: 12, maxLength: 200 },
          displayName: { type: 'string', minLength: 1, maxLength: 100 },
          locale: { type: 'string', pattern: '^[a-z]{2}(-[A-Z]{2})?$' },
          ibRefCode: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$' },
        },
      },
      response: { 201: userEnvelope },
    },
  }, async (req, reply) => {
    const address = normaliseEmail(req.body.email);
    const { displayName, locale = 'en', ibRefCode = null } = req.body;
    // Hash before opening the transaction; it is the slow part.
    const passwordHash = await hashPassword(req.body.password);

    const { user, token } = await inAcademy(req, async (db) => {
      const user = await db.maybeOne<User>(
        `INSERT INTO app.users (tenant_id, email, display_name, locale, password_hash, ib_ref_code)
         VALUES (app.current_tenant(), $1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, email) DO NOTHING
         RETURNING ${USER_COLUMNS}`,
        [address, displayName, locale, passwordHash, ibRefCode],
      );
      if (!user) throw new HttpError(409, 'email_taken', 'An account with this email already exists here.');

      await db.enqueue({
        type: 'lead.registered',
        payload: { user_id: user.id, email: address, display_name: displayName, locale, ib_ref_code: ibRefCode },
        idempotencyKey: `user.registered:${user.id}`,
        partitionKey: user.id,
      });
      return { user, token: await issueSession(db, user.id) };
    });

    setSessionCookie(reply, token);
    return reply.status(201).send({ user });
  });

  app.post<{ Body: LoginBody }>('/auth/login', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['email', 'password'],
        properties: { email, password: { type: 'string', minLength: 1, maxLength: 200 } },
      },
      response: { 200: userEnvelope },
    },
  }, async (req, reply) => {
    const address = normaliseEmail(req.body.email);

    const { user, token } = await inAcademy(req, async (db) => {
      const row = await db.maybeOne<User & { passwordHash: string | null }>(
        `SELECT ${USER_COLUMNS}, password_hash AS "passwordHash" FROM app.users WHERE email = $1`,
        [address],
      );
      // Unknown email and wrong password take the same path and the same time.
      const ok = await verifyPassword(req.body.password, row?.passwordHash ?? null);
      if (!row || !ok) throw new HttpError(401, 'invalid_credentials', 'Email or password is incorrect.');

      await db.query('UPDATE app.users SET last_seen_at = now() WHERE id = $1', [row.id]);
      const { passwordHash: _omit, ...user } = row;
      return { user, token: await issueSession(db, row.id) };
    });

    setSessionCookie(reply, token);
    return reply.send({ user });
  });

  app.post('/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await inAcademy(req, (db) => revokeSession(db, token));
    clearSessionCookie(reply);
    return reply.status(204).send();
  });
}
