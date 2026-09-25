/**
 * Module 3 · sign-up, login and logout, and the session that binds a
 * learner to one academy.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { shutdown, withControl, withTenant } from '../src/db/unitOfWork.js';
import { readSession } from '../src/auth/session.js';
import {
  NORTHGATE, PASSWORD, SABLE, outboxRows, removeHttpAccounts, server, sessionToken, signup, tenantId, uniqueEmail,
} from './httpHarness.js';

let app: FastifyInstance;
let northgate = '';
let sable = '';

before(async () => {
  await removeHttpAccounts();
  app = await server();
  northgate = await tenantId('northgate');
  sable = await tenantId('sable');
});

after(async () => {
  await app.close();
  await removeHttpAccounts();
  await shutdown();
});

const login = (host: string, email: string, password: string) =>
  app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { host }, payload: { email, password } });

test('sign-up creates the account, sets a host-only session cookie, and emits one lead', async () => {
  const email = uniqueEmail('signup');
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/signup',
    headers: { host: NORTHGATE },
    payload: { email, password: PASSWORD, displayName: 'Amira', ibRefCode: 'IB-4417' },
  });
  assert.equal(res.statusCode, 201);
  const { user } = res.json();
  assert.deepEqual(Object.keys(user).sort(), ['displayName', 'email', 'id', 'lifecycle']);
  assert.equal(user.lifecycle, 'registered');

  const cookie = res.cookies.find((c) => c.name === 'session');
  assert.ok(cookie?.value, 'a session cookie is set');
  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.secure, true);
  assert.equal(cookie.sameSite, 'Lax');
  assert.equal(cookie.domain, undefined, 'host-only: no Domain attribute');

  const stored = await withControl(async (c) =>
    (await c.query<{ tenant_id: string; ib_ref_code: string; password_hash: string }>(
      'SELECT tenant_id, ib_ref_code, password_hash FROM app.users WHERE id = $1', [user.id])).rows[0]!);
  assert.equal(stored.tenant_id, northgate);
  assert.equal(stored.ib_ref_code, 'IB-4417', 'the IB code is held for the first enrolment');
  assert.match(stored.password_hash, /^scrypt\$/);

  const events = await outboxRows(`user.registered:${user.id}`);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.event_type, 'lead.registered');
  assert.equal(events[0]!.tenant_id, northgate);
  assert.equal(events[0]!.payload.ib_ref_code, 'IB-4417');
});

test('a repeated sign-up is refused and creates no second account or event', async () => {
  const email = uniqueEmail('dupe');
  const first = await signup(app, NORTHGATE, { email });
  const again = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/signup',
    headers: { host: NORTHGATE },
    payload: { email: email.toUpperCase(), password: PASSWORD, displayName: 'Again' },
  });
  assert.equal(again.statusCode, 409);
  assert.equal(again.json().error.code, 'email_taken');
  assert.equal(sessionToken(again), undefined);

  const accounts = await withControl(async (c) =>
    Number((await c.query<{ n: string }>('SELECT count(*)::text AS n FROM app.users WHERE email = $1', [email])).rows[0]!.n));
  assert.equal(accounts, 1);
  assert.equal((await outboxRows(`user.registered:${first.userId}`)).length, 1);
});

test('the same email at another academy is a separate account', async () => {
  const email = uniqueEmail('twice');
  const atNorthgate = await signup(app, NORTHGATE, { email });
  const atSable = await signup(app, SABLE, { email });
  assert.notEqual(atNorthgate.userId, atSable.userId);
});

test('login succeeds with the right password and issues a fresh session', async () => {
  const { email, token } = await signup(app, NORTHGATE);
  const res = await login(NORTHGATE, email.toUpperCase(), PASSWORD);
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().user.email, email);
  const fresh = sessionToken(res);
  assert.ok(fresh);
  assert.notEqual(fresh, token);
});

test('a wrong password and an unknown email are indistinguishable', async () => {
  const { email } = await signup(app, NORTHGATE);
  const wrong = await login(NORTHGATE, email, 'not the password at all');
  const unknown = await login(NORTHGATE, uniqueEmail('nobody'), PASSWORD);
  assert.equal(wrong.statusCode, 401);
  assert.equal(unknown.statusCode, 401);
  assert.equal(wrong.body, unknown.body);
  assert.equal(sessionToken(wrong), undefined);
});

test('credentials from one academy do not log in at another', async () => {
  const { email } = await signup(app, NORTHGATE);
  const res = await login(SABLE, email, PASSWORD);
  assert.equal(res.statusCode, 401);
});

test('a session issued at one academy does not exist at another', async () => {
  const { token, userId } = await signup(app, NORTHGATE);
  const home = await withTenant({ tenantId: northgate }, (db) => readSession(db, token));
  const away = await withTenant({ tenantId: sable }, (db) => readSession(db, token));
  assert.equal(home?.id, userId);
  assert.equal(away, null, 'the token finds nothing under another academy');
});

test('logout revokes the session and clears the cookie', async () => {
  const { token } = await signup(app, NORTHGATE);
  const res = await app.inject({
    method: 'POST', url: '/api/v1/auth/logout', headers: { host: NORTHGATE, cookie: `session=${token}` },
  });
  assert.equal(res.statusCode, 204);
  const cleared = res.cookies.find((c) => c.name === 'session');
  assert.equal(cleared?.value, '');
  assert.equal(await withTenant({ tenantId: northgate }, (db) => readSession(db, token)), null);
});
