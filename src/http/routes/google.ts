/**
 * Google sign-in, for learners only. Three steps on two kinds of host:
 *
 *   start     academy host   records a state bound to this academy (PKCE
 *                            verifier, nonce, a binding to this browser)
 *                            and sends the learner to Google
 *   callback  callback host  the one address registered with Google, for
 *                            every academy: takes the state once, checks
 *                            Google's token, links or creates the learner
 *                            inside that academy, and sends them back
 *                            with a single-use handoff code
 *   complete  academy host   redeems the code, under this academy's RLS
 *                            and only in the browser that started, as an
 *                            ordinary learner session
 *
 * A sign-in started at one academy cannot finish at another: the handoff
 * is a row of the academy the state named, invisible under any other.
 * Nothing here touches studio roles or studio sessions, and an account
 * holding a studio role is refused.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  GoogleUnavailableError, InvalidIdTokenError, pkceChallenge, randomToken, sha256, type GoogleClient,
} from '../../auth/google.js';
import { issueSession } from '../../auth/session.js';
import { takeSsoState, withTenant } from '../../db/unitOfWork.js';
import { logger } from '../../logger.js';
import { inAcademy } from '../context.js';
import { HttpError } from '../errors.js';
import { publicOrigin } from '../sameOrigin.js';
import type { RouteLimit } from '../server.js';
import { setSessionCookie } from '../context.js';

export const BIND_COOKIE = 'sso_bind';
const BIND_PATH = '/api/v1/auth/google';

export interface GoogleSignIn {
  clientId: string;
  clientSecret: string;
  /** host[:port], as the browser sees it. */
  callbackHost: string;
  /** https://host/api/auth/google/callback, or http for localhost in development. */
  callbackUrl: string;
  client: GoogleClient;
}

/** Why a sign-in came back without a session, as /signin?sso= carries it. */
export type SsoReason = 'cancelled' | 'expired' | 'unavailable' | 'studio_account' | 'unverified' | 'conflict' | 'failed';

/** A relative path within the learner app, or nothing. */
function safeReturn(raw: string | undefined): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/studio') || raw.startsWith('/api')) return null;
  return raw.length <= 200 ? raw : null;
}

/** Where a learner belongs, from how far they have got. */
function homeFor(lifecycle: string): string {
  return lifecycle === 'registered' ? '/onboarding' : lifecycle === 'onboarded' ? '/placement' : '/path';
}

const bindCookie = (reply: FastifyReply) =>
  ({ path: BIND_PATH, httpOnly: true, secure: reply.server.sessionCookieSecure, sameSite: 'lax' }) as const;

/* ------------------------------------------------------------------ */
/* Academy host: start and complete                                    */
/* ------------------------------------------------------------------ */

export async function googleAcademyRoutes(app: FastifyInstance, opts: { google: GoogleSignIn; loginLimit: RouteLimit }): Promise<void> {
  const { google } = opts;
  const limit = { rateLimit: { max: opts.loginLimit.max, timeWindow: opts.loginLimit.windowMs } };

  app.get<{ Querystring: { ref?: string; next?: string } }>('/auth/google/start', {
    config: limit,
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: { ref: { type: 'string', maxLength: 64 }, next: { type: 'string', maxLength: 200 } },
      },
    },
  }, async (req, reply) => {
    const state = randomToken();
    const verifier = randomToken();
    const nonce = randomToken();
    const binding = randomToken();
    await inAcademy(req, (db) => db.query(
      `INSERT INTO app.sso_states (tenant_id, state_hash, code_verifier, nonce, binding_hash, ib_ref_code, return_to, origin)
       VALUES (app.current_tenant(), $1, $2, $3, $4, $5, $6, $7)`,
      [sha256(state), verifier, nonce, sha256(binding), req.query.ref?.trim() || null, safeReturn(req.query.next), publicOrigin(req)],
    ));
    // Ties the finish to this browser: a handoff link sent to someone else is useless.
    reply.setCookie(BIND_COOKIE, binding, { ...bindCookie(reply), maxAge: 600 });
    reply.header('cache-control', 'no-store');
    return reply.redirect(google.client.authorizeUrl({
      clientId: google.clientId, redirectUri: google.callbackUrl, state, challenge: pkceChallenge(verifier), nonce,
    }), 302);
  });

  app.get<{ Querystring: { code?: string } }>('/auth/google/complete', {
    config: limit,
    schema: { querystring: { type: 'object', additionalProperties: false, properties: { code: { type: 'string', maxLength: 128 } } } },
  }, async (req, reply) => {
    const binding = req.cookies[BIND_COOKIE];
    reply.clearCookie(BIND_COOKIE, bindCookie(reply));
    reply.header('cache-control', 'no-store');
    const code = req.query.code;
    if (!code || !binding) return reply.redirect('/signin?sso=expired', 303);

    const done = await inAcademy(req, async (db) => {
      // Under this academy's RLS: another academy's code is not here to redeem.
      const handoff = await db.maybeOne<{ userId: string; returnTo: string | null }>(
        `UPDATE app.sso_handoffs SET used_at = now()
          WHERE code_hash = $1 AND binding_hash = $2 AND used_at IS NULL AND expires_at > now()
          RETURNING user_id AS "userId", return_to AS "returnTo"`,
        [sha256(code), sha256(binding)],
      );
      await db.query(`DELETE FROM app.sso_handoffs WHERE expires_at < now() - interval '1 day'`);
      if (!handoff) return null;
      const user = await db.one<{ lifecycle: string }>(
        'UPDATE app.users SET last_seen_at = now() WHERE id = $1 RETURNING lifecycle', [handoff.userId]);
      await db.audit({ action: 'learner.sso_signed_in', entityType: 'user', entityId: handoff.userId, payload: { provider: 'google' } });
      return { token: await issueSession(db, handoff.userId), to: handoff.returnTo ?? homeFor(user.lifecycle) };
    });
    if (!done) return reply.redirect('/signin?sso=expired', 303);
    setSessionCookie(reply, done.token);
    return reply.redirect(done.to, 303);
  });
}

/* ------------------------------------------------------------------ */
/* Callback host                                                       */
/* ------------------------------------------------------------------ */

/** The one page the callback host shows: when it cannot tell which academy to go back to. */
function lostPage(reply: FastifyReply) {
  reply.status(400).header('content-type', 'text/html; charset=utf-8').header('cache-control', 'no-store')
    .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'");
  return reply.send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign-in expired</title>
<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;line-height:1.55;color:#14203A">
<h1 style="font-size:1.5rem">This sign-in has expired or was already used</h1>
<p>Go back to your academy's sign-in page and choose Continue with Google again.</p>
</body></html>`);
}

interface Resolved { code: string }
interface Refused { refused: SsoReason }

export async function googleCallbackRoutes(app: FastifyInstance, opts: { google: GoogleSignIn; limit: RouteLimit }): Promise<void> {
  const { google } = opts;

  app.addHook('onRequest', async (req: FastifyRequest) => {
    if (req.publicHost.toLowerCase() !== google.callbackHost) throw new HttpError(404, 'not_found', 'Not found.');
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>('/callback', {
    config: { rateLimit: { max: opts.limit.max, timeWindow: opts.limit.windowMs } },
    schema: {
      querystring: {
        type: 'object',
        properties: { code: { type: 'string', maxLength: 2048 }, state: { type: 'string', maxLength: 128 }, error: { type: 'string', maxLength: 128 } },
      },
    },
  }, async (req, reply) => {
    const { code, state, error } = req.query;
    const taken = state ? await takeSsoState(sha256(state)) : null;
    if (!taken) return lostPage(reply);

    const back = (reason: SsoReason) => reply.redirect(`${taken.origin}/signin?sso=${reason}`, 303);
    if (taken.expired) return back('expired');
    if (error) return back(error === 'access_denied' ? 'cancelled' : 'failed');
    if (!code) return back('failed');

    let identity;
    try {
      const idToken = await google.client.exchange({
        clientId: google.clientId, clientSecret: google.clientSecret, redirectUri: google.callbackUrl, code, verifier: taken.codeVerifier,
      });
      identity = await google.client.verify(idToken, { clientId: google.clientId, nonce: taken.nonce });
    } catch (err) {
      if (err instanceof GoogleUnavailableError) {
        logger.warn({ err: err.message }, 'google sign-in: Google unavailable');
        return back('unavailable');
      }
      if (err instanceof InvalidIdTokenError) {
        logger.warn({ err: err.message }, 'google sign-in: token refused');
        return back('failed');
      }
      throw err;
    }
    if (!identity.emailVerified) return back('unverified');

    const subject = `google:${identity.subject}`;
    // The academy comes from the state, which only that academy's host could have written.
    const outcome = await withTenant<Resolved | Refused>({ tenantId: taken.tenantId, actor: 'sso:google' }, async (db) => {
      const found = await db.maybeOne<{ id: string; roles: string[]; ssoSubject: string | null; hadPassword: boolean }>(
        `SELECT id, studio_roles AS roles, sso_subject AS "ssoSubject", password_hash IS NOT NULL AS "hadPassword"
           FROM app.users WHERE sso_subject = $1
         UNION ALL
         SELECT id, studio_roles, sso_subject, password_hash IS NOT NULL
           FROM app.users WHERE email = $2 AND NOT EXISTS (SELECT 1 FROM app.users WHERE sso_subject = $1)
         LIMIT 1`,
        [subject, identity.email],
      );

      if (found && found.roles.length > 0) {
        await db.audit({ action: 'learner.sso_refused', entityType: 'user', entityId: found.id, payload: { provider: 'google', reason: 'studio_account' } });
        return { refused: 'studio_account' };
      }
      if (found?.ssoSubject && found.ssoSubject !== subject) {
        await db.audit({ action: 'learner.sso_refused', entityType: 'user', entityId: found.id, payload: { provider: 'google', reason: 'conflict' } });
        return { refused: 'conflict' };
      }

      let userId: string;
      if (found && !found.ssoSubject) {
        // Linking by email. Sign-up here does not verify email, so a password
        // set before Google proved the address is cleared, and any other
        // session on the account ends.
        await db.query('UPDATE app.users SET sso_subject = $2, password_hash = NULL WHERE id = $1', [found.id, subject]);
        const revoked = await db.query(
          `UPDATE app.sessions SET revoked_at = now() WHERE user_id = $1 AND kind = 'learner' AND revoked_at IS NULL RETURNING id`, [found.id]);
        await db.audit({
          action: 'learner.sso_linked', entityType: 'user', entityId: found.id,
          payload: { provider: 'google', password_cleared: found.hadPassword, sessions_revoked: revoked.length },
        });
        userId = found.id;
      } else if (found) {
        userId = found.id;
      } else {
        const created = await db.one<{ id: string }>(
          `INSERT INTO app.users (tenant_id, email, display_name, sso_subject, ib_ref_code)
           VALUES (app.current_tenant(), $1, $2, $3, $4) RETURNING id`,
          [identity.email, identity.name ?? identity.email.split('@')[0]!, subject, taken.ibRefCode],
        );
        await db.audit({ action: 'learner.sso_registered', entityType: 'user', entityId: created.id, payload: { provider: 'google', ib_ref_code: taken.ibRefCode } });
        userId = created.id;
      }

      const handoff = randomToken();
      await db.query(
        `INSERT INTO app.sso_handoffs (tenant_id, code_hash, user_id, binding_hash, return_to)
         VALUES (app.current_tenant(), $1, $2, $3, $4)`,
        [sha256(handoff), userId, taken.bindingHash, taken.returnTo],
      );
      return { code: handoff };
    });

    if ('refused' in outcome) return back(outcome.refused);
    reply.header('cache-control', 'no-store');
    return reply.redirect(`${taken.origin}/api/v1/auth/google/complete?code=${outcome.code}`, 303);
  });
}
