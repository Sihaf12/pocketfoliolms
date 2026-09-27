/**
 * Google sign-in for learners, across the three hosts: the academy's, the
 * one callback host, and Google (a local stand-in). A sign-in started at
 * one academy cannot finish at another, a handoff code works once and
 * only in the browser that started, and no account holding a studio role
 * is ever signed in this way.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { shutdown } from '../src/db/unitOfWork.js';
import { buildServer, GoogleCallbackHostError } from '../src/http/server.js';
import { CLIENT_ID, CLIENT_SECRET, FakeGoogle } from './googleFake.js';
import {
  CALLBACK, CONSOLE, NORTHGATE, PASSWORD, SABLE, TEST_TOTP_KEY, asLearner, ownerPool, removeHttpAccounts, server, signup,
  studioMember, uniqueEmail,
} from './httpHarness.js';

let app: FastifyInstance;
const google = new FakeGoogle();

before(async () => {
  await removeHttpAccounts();
  app = await server({ google: { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, callbackHost: CALLBACK, client: google } });
});
beforeEach(() => { google.down = false; });
after(async () => {
  await app.close();
  await ownerPool.query(`DELETE FROM app.sso_states WHERE ib_ref_code LIKE 'HTTP-%' OR created_at < now() - interval '1 hour'`);
  await removeHttpAccounts();
  await shutdown();
});

const get = (host: string, url: string, cookie?: string) =>
  app.inject({ method: 'GET', url, headers: { host, ...(cookie ? { cookie } : {}) } });
const location = (res: LightMyRequestResponse) => new URL(String(res.headers.location), 'http://relative.invalid');

/** Starts at an academy: the state Google was sent, and the browser's binding cookie. */
async function start(host: string, query = '') {
  const res = await get(host, `/api/v1/auth/google/start${query}`);
  assert.equal(res.statusCode, 302, res.body);
  const state = google.lastAuthorize!.searchParams.get('state')!;
  const binding = res.cookies.find((c) => c.name === 'sso_bind')!;
  return { res, state, binding: binding.value, cookie: `sso_bind=${binding.value}` };
}

const callback = (query: string) => get(CALLBACK, `/api/auth/google/callback?${query}`);

/** Google returns with a code; the callback answers with where to go next. */
async function back(state: string) {
  return callback(`state=${encodeURIComponent(state)}&code=${encodeURIComponent(google.codeFor(state))}`);
}

/** All the way: start, Google, callback; the handoff code the academy is sent back with. */
async function throughGoogle(host: string, query = '') {
  const s = await start(host, query);
  const res = await back(s.state);
  assert.equal(res.statusCode, 303, res.body);
  const to = new URL(String(res.headers.location));
  assert.equal(to.host, host, 'back to the academy it started at');
  assert.equal(to.pathname, '/api/v1/auth/google/complete');
  return { ...s, code: to.searchParams.get('code')! };
}

const complete = (host: string, code: string, cookie?: string) => get(host, `/api/v1/auth/google/complete?code=${encodeURIComponent(code)}`, cookie);
const sessionOf = (res: LightMyRequestResponse) => res.cookies.find((c) => c.name === 'session')?.value;

async function userRow(email: string) {
  return (await ownerPool.query<{ id: string; sso_subject: string | null; password_hash: string | null; studio_roles: string[]; lifecycle: string; ib_ref_code: string | null; display_name: string }>(
    'SELECT id, sso_subject, password_hash, studio_roles, lifecycle, ib_ref_code, display_name FROM app.users WHERE email = $1', [email])).rows[0];
}
async function audit(userId: string) {
  return (await ownerPool.query<{ action: string; payload: Record<string, unknown> }>(
    'SELECT action, payload FROM app.system_audit_log WHERE entity_id = $1 ORDER BY seq', [userId])).rows;
}

test('start sends the learner to Google for openid, email and profile only, with PKCE, bound to this browser', async () => {
  const { res } = await start(NORTHGATE);
  const to = google.lastAuthorize!;
  assert.equal(to.searchParams.get('scope'), 'openid email profile');
  assert.equal(to.searchParams.get('code_challenge_method'), 'S256');
  assert.match(to.searchParams.get('code_challenge')!, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(to.searchParams.get('redirect_uri'), `https://${CALLBACK}/api/auth/google/callback`, 'one redirect for every academy');
  const cookie = res.cookies.find((c) => c.name === 'sso_bind')!;
  assert.deepEqual([cookie.httpOnly, cookie.sameSite, cookie.path], [true, 'Lax', '/api/v1/auth/google']);
  assert.equal((await get(NORTHGATE, '/api/v1/academy')).json().googleSignIn, true);
});

test('a new learner is created registered, with the page\'s referral, and signed in on their academy', async () => {
  const email = uniqueEmail('google-new');
  google.person = { sub: `new-${email}`, email, name: 'Ada Google' };
  const { code, cookie } = await throughGoogle(NORTHGATE, '?ref=HTTP-IB77&next=/path');
  const done = await complete(NORTHGATE, code, cookie);
  assert.equal(done.statusCode, 303);
  assert.equal(done.headers.location, '/path', 'where the learner asked to go');
  const token = sessionOf(done)!;
  assert.ok(token);

  const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { host: NORTHGATE, ...asLearner(token) } });
  assert.equal(me.statusCode, 200);
  assert.deepEqual([me.json().user.displayName, me.json().user.lifecycle, me.json().user.ibRefCode], ['Ada Google', 'registered', 'HTTP-IB77']);
  const row = (await userRow(email))!;
  assert.deepEqual(row.studio_roles, [], 'never a studio role by this route');
  assert.equal(row.password_hash, null);
  assert.deepEqual((await audit(row.id)).map((a) => a.action), ['learner.sso_registered', 'learner.sso_signed_in']);

  // Without a next page, a new learner goes to onboarding.
  const again = await throughGoogle(NORTHGATE);
  assert.equal((await complete(NORTHGATE, again.code, again.cookie)).headers.location, '/onboarding');
});

test('a learner with the same email is linked: the password is cleared and other sessions end, all audited', async () => {
  const existing = await signup(app, NORTHGATE);
  google.person = { sub: `link-${existing.email}`, email: existing.email.toUpperCase() };
  const { code, cookie } = await throughGoogle(NORTHGATE);
  const done = await complete(NORTHGATE, code, cookie);
  assert.equal(done.statusCode, 303);

  const row = (await userRow(existing.email))!;
  assert.equal(row.sso_subject, `google:link-${existing.email}`);
  assert.equal(row.password_hash, null, 'a password set before Google proved the address is cleared');
  const old = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { host: NORTHGATE, ...asLearner(existing.token) } });
  assert.equal(old.statusCode, 401, 'the session from before ends');
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { host: NORTHGATE }, payload: { email: existing.email, password: PASSWORD } });
  assert.equal(login.statusCode, 401);
  const linked = (await audit(existing.userId)).find((a) => a.action === 'learner.sso_linked')!;
  assert.deepEqual([linked.payload.password_cleared, linked.payload.sessions_revoked], [true, 1]);

  // Back later with a changed Google email: found by Google's id, not the address.
  google.person = { sub: `link-${existing.email}`, email: uniqueEmail('changed') };
  const later = await throughGoogle(NORTHGATE);
  const token = sessionOf(await complete(NORTHGATE, later.code, later.cookie))!;
  const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { host: NORTHGATE, ...asLearner(token) } });
  assert.equal(me.json().user.id, existing.userId);
});

test('a sign-in started at one academy cannot finish at another', async () => {
  const email = uniqueEmail('google-cross');
  google.person = { sub: `cross-${email}`, email };
  const { code, cookie } = await throughGoogle(NORTHGATE);

  const elsewhere = await complete(SABLE, code, cookie);
  assert.equal(elsewhere.statusCode, 303);
  assert.equal(elsewhere.headers.location, '/signin?sso=expired');
  assert.equal(sessionOf(elsewhere), undefined, 'no session at the other academy');
  const sableCopy = await ownerPool.query(
    `SELECT 1 FROM app.users u JOIN app.tenants t ON t.id = u.tenant_id WHERE u.email = $1 AND t.slug = 'sable'`, [email]);
  assert.equal(sableCopy.rowCount, 0, 'and no account there');

  const home = await complete(NORTHGATE, code, cookie);
  assert.ok(sessionOf(home), 'the other academy consumed nothing: the code still works where it began');
});

test('a handoff code works once, in the browser that started, within its minute', async () => {
  google.person = { sub: 'replay', email: uniqueEmail('google-replay') };
  const first = await throughGoogle(NORTHGATE);
  assert.ok(sessionOf(await complete(NORTHGATE, first.code, first.cookie)));
  const replay = await complete(NORTHGATE, first.code, first.cookie);
  assert.equal(replay.headers.location, '/signin?sso=expired', 'a replayed code is refused');
  assert.equal(sessionOf(replay), undefined);

  const second = await throughGoogle(NORTHGATE);
  assert.equal((await complete(NORTHGATE, second.code)).headers.location, '/signin?sso=expired', 'without the binding cookie');
  assert.equal((await complete(NORTHGATE, second.code, 'sso_bind=someone-elses')).headers.location, '/signin?sso=expired', 'with another browser\'s');
  assert.ok(sessionOf(await complete(NORTHGATE, second.code, second.cookie)), 'neither consumed it');

  const third = await throughGoogle(NORTHGATE);
  await ownerPool.query(`UPDATE app.sso_handoffs SET expires_at = now() - interval '1 second' WHERE used_at IS NULL`);
  assert.equal((await complete(NORTHGATE, third.code, third.cookie)).headers.location, '/signin?sso=expired', 'after sixty seconds');
});

test('a callback works once; an unknown or used state gets a page that names no academy', async () => {
  google.person = { sub: 'state-once', email: uniqueEmail('google-state') };
  const s = await start(NORTHGATE);
  assert.equal((await back(s.state)).statusCode, 303);
  const again = await back(s.state);
  assert.equal(again.statusCode, 400);
  assert.match(again.body, /expired or was already used/);
  assert.doesNotMatch(again.body, /Northgate/i);
  assert.equal((await callback('state=made-up&code=x')).statusCode, 400);
  assert.equal((await callback('code=x')).statusCode, 400);
});

test('the ways back without a session: expired, cancelled, studio account, unverified, conflict, Google down', async () => {
  const reason = async (res: LightMyRequestResponse) => {
    assert.equal(res.statusCode, 303, res.body);
    const to = location(res);
    assert.equal(String(res.headers.location).startsWith(`http://${NORTHGATE}/signin`), true, 'back to the academy\'s sign-in');
    return to.searchParams.get('sso');
  };

  const expired = await start(NORTHGATE);
  await ownerPool.query(`UPDATE app.sso_states SET expires_at = now() - interval '1 second' WHERE expires_at > now()`);
  assert.equal(await reason(await back(expired.state)), 'expired');

  const denied = await start(NORTHGATE);
  assert.equal(await reason(await callback(`state=${denied.state}&error=access_denied`)), 'cancelled');
  assert.equal((await back(denied.state)).statusCode, 400, 'the state is spent');

  const member = await studioMember('northgate', ['author']);
  google.person = { sub: 'studio-person', email: member.email };
  assert.equal(await reason(await back((await start(NORTHGATE)).state)), 'studio_account');
  const row = (await userRow(member.email))!;
  assert.equal(row.sso_subject, null, 'nothing linked');
  assert.ok(row.password_hash, 'the studio password is untouched');
  assert.deepEqual((await audit(member.id)).filter((a) => a.action === 'learner.sso_refused').map((a) => a.payload.reason), ['studio_account']);

  google.person = { sub: 'unverified', email: uniqueEmail('google-unverified'), emailVerified: false };
  assert.equal(await reason(await back((await start(NORTHGATE)).state)), 'unverified');

  const taken = await signup(app, NORTHGATE);
  await ownerPool.query(`UPDATE app.users SET sso_subject = 'google:someone-else' WHERE id = $1`, [taken.userId]);
  google.person = { sub: 'not-someone-else', email: taken.email };
  assert.equal(await reason(await back((await start(NORTHGATE)).state)), 'conflict');

  google.person = { sub: 'down', email: uniqueEmail('google-down') };
  google.down = true;
  assert.equal(await reason(await back((await start(NORTHGATE)).state)), 'unavailable');
});

test('the callback answers on its own host only, and the academy routes never on it', async () => {
  const s = await start(NORTHGATE);
  for (const host of [NORTHGATE, CONSOLE]) {
    assert.equal((await get(host, `/api/auth/google/callback?state=${s.state}&code=x`)).statusCode, 404, host);
  }
  assert.equal((await get(CALLBACK, '/api/v1/auth/google/start')).json().error.code, 'unknown_academy');
});

test('the server refuses a callback host that is plain http outside development, the console\'s, or an academy\'s', async () => {
  const stand = new FakeGoogle();
  const build = (callbackHost: string) => buildServer({
    console: { host: CONSOLE, totpKey: TEST_TOTP_KEY },
    google: { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, callbackHost, client: stand },
  });
  await assert.rejects(build(CONSOLE), GoogleCallbackHostError);
  await assert.rejects(build(NORTHGATE), GoogleCallbackHostError);
  const saved = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    await assert.rejects(build('localhost:3100'), GoogleCallbackHostError);
    process.env.NODE_ENV = 'development';
    const local = await build('localhost:3100');
    const res = await local.inject({ method: 'GET', url: '/api/v1/auth/google/start', headers: { host: NORTHGATE } });
    assert.equal(res.statusCode, 302);
    assert.equal(stand.lastAuthorize!.searchParams.get('redirect_uri'), 'http://localhost:3100/api/auth/google/callback', 'plain http for localhost in development only');
    await local.close();
  } finally {
    if (saved === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = saved;
  }
  const off = await buildServer({ console: { host: CONSOLE, totpKey: TEST_TOTP_KEY }, google: { clientId: '', clientSecret: '', callbackHost: '' } });
  assert.equal((await off.inject({ method: 'GET', url: '/api/v1/academy', headers: { host: NORTHGATE } })).json().googleSignIn, false);
  assert.equal((await off.inject({ method: 'GET', url: '/api/v1/auth/google/start', headers: { host: NORTHGATE } })).statusCode, 404);
  await off.close();
});
