/**
 * Module 4a · stage 2: studio sign-in, the studio team, and invitations.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { shutdown, withControl } from '../src/db/unitOfWork.js';
import {
  NORTHGATE, PASSWORD, SABLE, asLearner, asStudio, removeHttpAccounts, server, signup, studioLogin,
  studioMember, uniqueEmail,
} from './httpHarness.js';

let app: FastifyInstance;

before(async () => {
  await removeHttpAccounts();
  app = await server();
});

after(async () => {
  await app.close();
  await removeHttpAccounts();
  await shutdown();
});

const studio = (method: string, url: string, host: string, token?: string, payload?: Record<string, unknown>, extra: Record<string, string> = {}) =>
  app.inject({ method: method as 'GET', url: `/api/studio${url}`, headers: { host, ...(token ? asStudio(token) : {}), ...extra }, ...(payload !== undefined ? { payload } : {}) });

async function auditActions(entityId: string): Promise<string[]> {
  return withControl(async (c) =>
    (await c.query<{ action: string }>('SELECT action FROM app.system_audit_log WHERE entity_id = $1 ORDER BY seq', [entityId])).rows.map((r) => r.action));
}

async function adminAt(host = NORTHGATE, slug = 'northgate') {
  const admin = await studioMember(slug, ['tenant_admin'], 'admin');
  const { token } = await studioLogin(app, host, admin.email);
  return { ...admin, token: token! };
}

async function invite(adminToken: string, email: string, roles: string[], host = NORTHGATE) {
  const res = await studio('POST', '/users', host, adminToken, { email, roles });
  assert.equal(res.statusCode, 201, res.body);
  const body = res.json();
  return { id: body.invitation.id as string, token: (body.link as string).split('/studio/invite/')[1]!, link: body.link as string };
}

test('studio sign-in admits studio roles only, with its own strict cookie', async () => {
  const member = await studioMember('northgate', ['author', 'reviewer']);
  const { res, token } = await studioLogin(app, NORTHGATE, member.email);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().user.roles, ['author', 'reviewer']);
  const cookie = res.cookies.find((c) => c.name === 'studio_session')!;
  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.sameSite, 'Strict');
  assert.equal(cookie.domain, undefined, 'host-only');
  assert.ok(token);

  const learner = await signup(app, NORTHGATE);
  const refused = await studioLogin(app, NORTHGATE, learner.email);
  const wrong = await studioLogin(app, NORTHGATE, member.email, 'not the password');
  assert.equal(refused.res.statusCode, 401);
  assert.equal(refused.res.body, wrong.res.body, 'a learner is told exactly what a wrong password is told');
});

test('a learner session is never a studio session, and neither crosses academies', async () => {
  const learner = await signup(app, NORTHGATE);
  assert.equal((await app.inject({ method: 'GET', url: '/api/studio/me', headers: { host: NORTHGATE, cookie: `studio_session=${learner.token}` } })).statusCode, 401,
    'a learner token in the studio cookie');

  const member = await studioMember('northgate', ['author']);
  const { token } = await studioLogin(app, NORTHGATE, member.email);
  assert.equal((await studio('GET', '/me', NORTHGATE, token)).statusCode, 200);
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/me', headers: { host: NORTHGATE, ...asLearner(token!) } })).statusCode, 401,
    'a studio token in the learner cookie');
  assert.equal((await studio('GET', '/me', SABLE, token)).statusCode, 401, 'the session does not exist at another academy');
});

test('/me names the person, their roles, the academy and its sign-off rule', async () => {
  const member = await studioMember('northgate', ['compliance']);
  const { token } = await studioLogin(app, NORTHGATE, member.email);
  const body = (await studio('GET', '/me', NORTHGATE, token)).json();
  assert.deepEqual(body.user.roles, ['compliance']);
  assert.equal(body.academy.name, 'Northgate Markets');
  assert.equal(body.reviewSignoffs, 2, 'the default');
});

test('only a tenant admin manages the team', async () => {
  const author = await studioMember('northgate', ['author', 'reviewer', 'compliance']);
  const { token } = await studioLogin(app, NORTHGATE, author.email);
  assert.equal((await studio('GET', '/users', NORTHGATE, token)).statusCode, 403, 'every other role, together, is still not admin');
  assert.equal((await studio('POST', '/users', NORTHGATE, token, { email: uniqueEmail('x'), roles: ['author'] })).statusCode, 403);
  const admin = await adminAt();
  assert.equal((await studio('GET', '/users', NORTHGATE, admin.token)).statusCode, 200);
});

test('an invitation is shown once, works once, only at its academy, and is audited', async () => {
  const admin = await adminAt();
  const email = uniqueEmail('invitee');
  const inv = await invite(admin.token, email, ['author', 'reviewer']);
  assert.match(inv.link, /^http:\/\/learn\.northgate\.ae\/studio\/invite\/[A-Za-z0-9_-]{40,}$/);

  const listed = await studio('GET', '/users', NORTHGATE, admin.token);
  assert.ok(listed.json().invitations.some((i: { id: string; state: string }) => i.id === inv.id && i.state === 'pending'));
  assert.ok(!listed.body.includes(inv.token), 'the token is never shown again');

  const elsewhere = await studio('POST', '/invitations/accept', SABLE, undefined, { token: inv.token, password: PASSWORD, displayName: 'New Person' });
  assert.equal(elsewhere.statusCode, 404, 'it belongs to one academy');

  const accepted = await studio('POST', '/invitations/accept', NORTHGATE, undefined, { token: inv.token, password: PASSWORD, displayName: 'New Person' });
  assert.equal(accepted.statusCode, 201, accepted.body);
  assert.deepEqual(accepted.json().user.roles, ['author', 'reviewer']);
  assert.ok(accepted.cookies.some((c) => c.name === 'studio_session' && c.value));

  const again = await studio('POST', '/invitations/accept', NORTHGATE, undefined, { token: inv.token, password: PASSWORD, displayName: 'Again' });
  assert.equal(again.statusCode, 404, 'single use');

  assert.deepEqual(await auditActions(inv.id), ['studio.invitation_created', 'studio.invitation_accepted']);
});

test('an expired or revoked invitation is refused', async () => {
  const admin = await adminAt();
  const expired = await invite(admin.token, uniqueEmail('late'), ['author']);
  await withControl((c) => c.query(
    `UPDATE app.studio_invitations SET created_at = now() - interval '80 hours', expires_at = now() - interval '8 hours' WHERE id = $1`, [expired.id]));
  assert.equal((await studio('POST', '/invitations/accept', NORTHGATE, undefined, { token: expired.token, password: PASSWORD, displayName: 'Late' })).statusCode, 404);

  const revoked = await invite(admin.token, uniqueEmail('revoked'), ['author']);
  assert.equal((await studio('DELETE', `/users/invitations/${revoked.id}`, NORTHGATE, admin.token)).statusCode, 204);
  assert.equal((await studio('POST', '/invitations/accept', NORTHGATE, undefined, { token: revoked.token, password: PASSWORD, displayName: 'Revoked' })).statusCode, 404);
  assert.deepEqual(await auditActions(revoked.id), ['studio.invitation_created', 'studio.invitation_revoked']);
});

test('someone who already learns here proves it with their own password, and keeps their account', async () => {
  const admin = await adminAt();
  const learner = await signup(app, NORTHGATE);
  const inv = await invite(admin.token, learner.email, ['reviewer']);

  const wrong = await studio('POST', '/invitations/accept', NORTHGATE, undefined, { token: inv.token, password: 'someone else entirely' });
  assert.equal(wrong.statusCode, 401);
  const right = await studio('POST', '/invitations/accept', NORTHGATE, undefined, { token: inv.token, password: PASSWORD });
  assert.equal(right.statusCode, 201, 'the failed attempt did not use up the invitation');
  assert.equal(right.json().user.id, learner.userId, 'the same account, now with a studio role');
  assert.deepEqual(right.json().user.roles, ['reviewer']);
  const role = await withControl(async (c) =>
    (await c.query<{ role: string }>('SELECT role FROM app.users WHERE id = $1', [learner.userId])).rows[0]!.role);
  assert.equal(role, 'learner', 'still a learner too');
});

test('roles are a set, the last admin cannot be removed, and removing every role ends studio access', async () => {
  const admin = await adminAt();
  const member = await studioMember('northgate', ['author']);
  const { token } = await studioLogin(app, NORTHGATE, member.email);

  const both = await studio('PATCH', `/users/${member.id}`, NORTHGATE, admin.token, { roles: ['reviewer', 'author'] });
  assert.deepEqual(both.json().user.roles, ['author', 'reviewer'], 'stored sorted');
  assert.equal((await studio('PATCH', `/users/${member.id}`, NORTHGATE, admin.token, { roles: ['learner'] })).statusCode, 400);

  await withControl((c) => c.query(
    `UPDATE app.users SET studio_roles = array_remove(studio_roles, 'tenant_admin')
      WHERE tenant_id = (SELECT id FROM app.tenants WHERE slug = 'northgate') AND id <> $1`, [admin.id]));
  const last = await studio('PATCH', `/users/${admin.id}`, NORTHGATE, admin.token, { roles: ['author'] });
  assert.equal(last.statusCode, 409);
  assert.equal(last.json().error.code, 'last_admin');

  assert.equal((await studio('PATCH', `/users/${member.id}`, NORTHGATE, admin.token, { roles: [] })).statusCode, 200);
  assert.equal((await studio('GET', '/me', NORTHGATE, token)).statusCode, 401, 'their studio session is over');

  const learner = await signup(app, NORTHGATE);
  assert.equal((await studio('PATCH', `/users/${learner.userId}`, NORTHGATE, admin.token, { roles: ['author'] })).statusCode, 404,
    'a learner joins the studio by invitation, not by an edit');
});

test('a write from another site is refused', async () => {
  const member = await studioMember('northgate', ['author']);
  const { token } = await studioLogin(app, NORTHGATE, member.email);
  const evil = await studio('POST', '/auth/logout', NORTHGATE, token, undefined, { origin: 'http://evil.example' });
  assert.equal(evil.statusCode, 403);
  assert.equal(evil.json().error.code, 'cross_site_refused');
  const crossSite = await studio('POST', '/auth/logout', NORTHGATE, token, undefined, { 'sec-fetch-site': 'cross-site' });
  assert.equal(crossSite.statusCode, 403);
  const same = await studio('POST', '/auth/logout', NORTHGATE, token, undefined, { origin: 'http://learn.northgate.ae:3000' });
  assert.equal(same.statusCode, 204, 'its own origin is fine');
});

test('the studio shell reads the academy\'s name and brand before sign-in, and nothing else', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/studio/academy', headers: { host: NORTHGATE } });
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(Object.keys(res.json()).sort(), ['name', 'sub', 'tokens']);
  assert.equal(res.json().tokens['--brand'], '#1A6DC2');
  assert.equal((await app.inject({ method: 'GET', url: '/api/studio/academy', headers: { host: 'learn.unknown.example' } })).statusCode, 404);
});
