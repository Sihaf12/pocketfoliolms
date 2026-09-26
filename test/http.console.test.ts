/**
 * Module 4a · stage 2: the platform console. Sign-in with TOTP, staff
 * invitations, and provisioning an academy end to end.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { shutdown } from '../src/db/unitOfWork.js';
import { stepOf, totpAt } from '../src/auth/totp.js';
import {
  CONSOLE, NORTHGATE, PASSWORD, asStaff, ownerPool, removeConsoleFixtures, removeHttpAccounts, server, staffMember,
  studioLogin, uniqueEmail,
} from './httpHarness.js';

let app: FastifyInstance;
let slugCounter = 0;
const slug = () => `http-${process.pid}-${++slugCounter}`;

before(async () => {
  await removeConsoleFixtures();
  app = await server();
});

after(async () => {
  await app.close();
  await removeHttpAccounts();
  await removeConsoleFixtures();
  await ownerPool.end();
  await shutdown();
});

const consoleCall = (method: string, url: string, token?: string, payload?: Record<string, unknown>, host = CONSOLE) =>
  app.inject({ method: method as 'GET', url: `/api/console${url}`, headers: { host, ...(token ? asStaff(token) : {}) }, ...(payload !== undefined ? { payload } : {}) });

const nowCode = (secret: string, offset = 0) => totpAt(secret, stepOf(Date.now() / 1000) + offset);

async function signIn(member: { email: string; secret: string | null }, code?: string) {
  const res = await consoleCall('POST', '/auth/login', undefined, { email: member.email, password: PASSWORD, ...(code ? { code } : {}) });
  return { res, token: res.cookies.find((c) => c.name === 'console_session')?.value };
}

async function owner() {
  const member = await staffMember('platform_owner');
  const { token } = await signIn(member, nowCode(member.secret!));
  return { ...member, token: token! };
}

async function platformAudit(entityId: string): Promise<string[]> {
  return (await ownerPool.query<{ action: string }>('SELECT action FROM platform.audit_log WHERE entity_id = $1 ORDER BY seq', [entityId])).rows.map((r) => r.action);
}

test('the owner signs in only with a TOTP code, and a code works once', async () => {
  const member = await staffMember('platform_owner');
  assert.equal((await signIn(member)).res.statusCode, 401, 'no code');
  assert.equal((await signIn(member, '000000')).res.statusCode, 401, 'a wrong code');

  const code = nowCode(member.secret!);
  const first = await signIn(member, code);
  assert.equal(first.res.statusCode, 200, first.res.body);
  const cookie = first.res.cookies.find((c) => c.name === 'console_session')!;
  assert.equal(cookie.sameSite, 'Strict');
  assert.equal(cookie.httpOnly, true);

  const replay = await signIn(member, code);
  assert.equal(replay.res.statusCode, 401, 'the same code again');
  assert.equal(replay.res.body, (await signIn(member, '000000')).res.body, 'every refusal reads the same');
  assert.equal((await signIn(member, nowCode(member.secret!, 1))).res.statusCode, 200, 'the next code is new');

  const me = await consoleCall('GET', '/me', first.token);
  assert.equal(me.json().staff.role, 'platform_owner');
});

test('other staff sign in without TOTP unless they have enrolled it, and cannot manage academies', async () => {
  const author = await staffMember('platform_author');
  const { res, token } = await signIn(author);
  assert.equal(res.statusCode, 200);
  assert.equal((await consoleCall('GET', '/tenants', token)).statusCode, 403);
  assert.equal((await consoleCall('POST', '/staff', token, { email: uniqueEmail('s'), role: 'platform_author' })).statusCode, 403);

  const enrolled = await staffMember('platform_reviewer', { totp: true });
  assert.equal((await signIn(enrolled)).res.statusCode, 401, 'enrolled means the code is required');
  assert.equal((await signIn(enrolled, nowCode(enrolled.secret!))).res.statusCode, 200);
});

test('the console answers on its host only', async () => {
  const boss = await owner();
  assert.equal((await consoleCall('GET', '/me', boss.token, undefined, NORTHGATE)).statusCode, 404, 'not on an academy host');
  const learnerRoute = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { host: CONSOLE } });
  assert.equal(learnerRoute.json().error.code, 'unknown_academy', 'and academy routes are not on the console host');
  const page = await app.inject({ method: 'GET', url: '/', headers: { host: CONSOLE } });
  assert.equal(page.statusCode, 404);
});

test('creating an academy provisions it whole, audits it, and its first admin can sign in', async () => {
  const boss = await owner();
  const domain = `${slug()}.academy.test`;
  const created = await consoleCall('POST', '/tenants', boss.token, {
    slug: domain.split('.')[0], name: 'Harbour Trading', primaryDomain: domain, adminEmail: uniqueEmail('firstadmin'),
  });
  assert.equal(created.statusCode, 201, created.body);
  const { tenant, link } = created.json();
  assert.equal(tenant.primaryDomain, domain);
  assert.match(link, new RegExp(`^http://${domain.replace(/\./g, '\\.')}/studio/invite/[A-Za-z0-9_-]{40,}$`));

  const page = await app.inject({ method: 'GET', url: '/', headers: { host: domain } });
  assert.equal(page.statusCode, 200, 'the new academy answers at once');

  const catalogue = await ownerPool.query(`SELECT count(*)::int AS n FROM app.tenant_catalogues WHERE tenant_id = $1 AND enabled`, [tenant.id]);
  const published = await ownerPool.query(`SELECT count(*)::int AS n FROM platform.courses WHERE owner_tenant_id IS NULL AND review_state = 'published'`);
  assert.equal(catalogue.rows[0].n, published.rows[0].n, 'every published platform course is switched on');

  const token = link.split('/studio/invite/')[1];
  const accepted = await app.inject({
    method: 'POST', url: '/api/studio/invitations/accept', headers: { host: domain },
    payload: { token, password: PASSWORD, displayName: 'First Admin' },
  });
  assert.equal(accepted.statusCode, 201, accepted.body);
  assert.deepEqual(accepted.json().user.roles, ['tenant_admin']);
  assert.equal((await studioLogin(app, domain, accepted.json().user.email)).res.statusCode, 200);

  assert.deepEqual(await platformAudit(tenant.id), ['tenant.created']);
  const invitation = await ownerPool.query(`SELECT id FROM app.studio_invitations WHERE tenant_id = $1`, [tenant.id]);
  assert.deepEqual(await platformAudit(invitation.rows[0].id), ['tenant.admin_invited']);
});

test('an academy cannot take a used slug or domain, the console\'s host, or something that is not a host', async () => {
  const boss = await owner();
  const base = { name: 'Clash', adminEmail: uniqueEmail('clash') };
  assert.equal((await consoleCall('POST', '/tenants', boss.token, { ...base, slug: 'northgate', primaryDomain: `${slug()}.academy.test` })).json().error.code, 'slug_taken');
  assert.equal((await consoleCall('POST', '/tenants', boss.token, { ...base, slug: slug(), primaryDomain: NORTHGATE })).json().error.code, 'domain_taken');
  assert.equal((await consoleCall('POST', '/tenants', boss.token, { ...base, slug: slug(), primaryDomain: CONSOLE })).json().error.code, 'invalid_domain');
  for (const bad of ['not a host', 'UPPER.academy.test.', 'x.academy.test:8080', 'localhost']) {
    assert.equal((await consoleCall('POST', '/tenants', boss.token, { ...base, slug: slug(), primaryDomain: bad })).statusCode, 400, bad);
  }
});

test('suspending an academy takes its host offline, and reactivating brings it back', async () => {
  const boss = await owner();
  const domain = `${slug()}.academy.test`;
  const { tenant } = (await consoleCall('POST', '/tenants', boss.token, {
    slug: domain.split('.')[0], name: 'Pause Test', primaryDomain: domain, adminEmail: uniqueEmail('pause'),
  })).json();
  assert.equal((await consoleCall('PATCH', `/tenants/${tenant.id}`, boss.token, { status: 'suspended' })).statusCode, 200);
  assert.equal((await app.inject({ method: 'GET', url: '/', headers: { host: domain } })).statusCode, 404);
  await consoleCall('PATCH', `/tenants/${tenant.id}`, boss.token, { status: 'active' });
  assert.equal((await app.inject({ method: 'GET', url: '/', headers: { host: domain } })).statusCode, 200);
  assert.deepEqual(await platformAudit(tenant.id), ['tenant.created', 'tenant.status_changed', 'tenant.status_changed']);
});

test('platform staff join by invitation: single use, 72 hours, never as owner, audited', async () => {
  const boss = await owner();
  assert.equal((await consoleCall('POST', '/staff', boss.token, { email: uniqueEmail('o'), role: 'platform_owner' })).statusCode, 400,
    'owners are provisioned from the command line, with TOTP');

  const email = uniqueEmail('newstaff');
  const made = await consoleCall('POST', '/staff', boss.token, { email, role: 'platform_reviewer' });
  assert.equal(made.statusCode, 201, made.body);
  const { invitation, link } = made.json();
  assert.match(link, /^http:\/\/console\.academy\.test\/invite\/[A-Za-z0-9_-]{40,}$/);
  const token = link.split('/invite/')[1];
  assert.ok(!(await consoleCall('GET', '/staff', boss.token)).body.includes(token), 'the link is shown once');

  const accepted = await consoleCall('POST', '/staff/invitations/accept', undefined, { token, displayName: 'New Reviewer', password: PASSWORD });
  assert.equal(accepted.statusCode, 201, accepted.body);
  assert.equal(accepted.json().staff.role, 'platform_reviewer');
  assert.equal((await consoleCall('POST', '/staff/invitations/accept', undefined, { token, displayName: 'Again', password: PASSWORD })).statusCode, 404);
  assert.deepEqual(await platformAudit(invitation.id), ['staff.invitation_created', 'staff.invitation_accepted']);

  const late = (await consoleCall('POST', '/staff', boss.token, { email: uniqueEmail('late'), role: 'platform_author' })).json();
  await ownerPool.query(
    `UPDATE platform.staff_invitations SET created_at = now() - interval '80 hours', expires_at = now() - interval '8 hours' WHERE id = $1`, [late.invitation.id]);
  assert.equal((await consoleCall('POST', '/staff/invitations/accept', undefined, {
    token: late.link.split('/invite/')[1], displayName: 'Late', password: PASSWORD,
  })).statusCode, 404, 'expired after 72 hours');
});

test('the first admin\'s invitation can be reissued until they join, and each reissue is audited', async () => {
  const boss = await owner();
  const domain = `${slug()}.academy.test`;
  const created = (await consoleCall('POST', '/tenants', boss.token, {
    slug: domain.split('.')[0], name: 'Reissue Trading', primaryDomain: domain, adminEmail: uniqueEmail('firstadmin'),
  })).json();
  const firstToken = (created.link as string).split('/studio/invite/')[1]!;
  assert.equal((await consoleCall('GET', `/tenants/${created.tenant.id}`, boss.token)).json().firstAdmin.state, 'waiting');

  const res = await consoleCall('POST', `/tenants/${created.tenant.id}/admin-invitation/reissue`, boss.token);
  assert.equal(res.statusCode, 201, res.body);
  const token = (res.json().link as string).split('/studio/invite/')[1]!;
  assert.notEqual(token, firstToken);

  const accept = (t: string) => app.inject({
    method: 'POST', url: '/api/studio/invitations/accept', headers: { host: domain },
    payload: { token: t, password: PASSWORD, displayName: 'First Admin' },
  });
  assert.equal((await accept(firstToken)).statusCode, 404, 'the old link no longer works');
  assert.equal((await accept(token)).statusCode, 201);
  assert.equal((await consoleCall('GET', `/tenants/${created.tenant.id}`, boss.token)).json().firstAdmin.state, 'joined');
  assert.equal((await consoleCall('POST', `/tenants/${created.tenant.id}/admin-invitation/reissue`, boss.token)).json().error.code, 'already_joined');

  const audit = await ownerPool.query<{ action: string }>(
    `SELECT action FROM platform.audit_log WHERE payload->>'tenant_id' = $1 AND action = 'tenant.admin_reinvited'`, [created.tenant.id]);
  assert.equal(audit.rows.length, 1);
});
