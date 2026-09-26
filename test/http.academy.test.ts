/**
 * Module 4a · stage 4: what a tenant admin runs in the studio (catalogue,
 * learners, brand, review sign-offs, domain, CRM, outbox) and the
 * console's owner-only counterparts: domain override and outbox replay.
 *
 * Each test that changes an academy's settings gets its own http-
 * academy, so the seeded academies the SQL proofs count stay as they are.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { shutdown } from '../src/db/unitOfWork.js';
import { stepOf, totpAt } from '../src/auth/totp.js';
import { forgetResolvedHosts } from '../src/http/tenantScope.js';
import { HttpDispatcher } from '../src/outbox/relay.js';
import { isBlockedAddress, isObviouslyInternalHost } from '../src/net/address.js';
import {
  CONSOLE, NORTHGATE, PASSWORD, asStaff, asStudio, ownerPool, placedLearner, removeConsoleFixtures,
  removeContentFixtures, removeHttpAccounts, server, staffMember, studioLogin, studioMember,
} from './httpHarness.js';

let app: FastifyInstance;
let n = 0;
const next = () => `http-${process.pid}-${++n}`;

/** TXT records the stub resolver answers with, by name. */
const txt = new Map<string, string[][]>();

before(async () => {
  await removeConsoleFixtures();
  await removeContentFixtures();
  app = await server({
    resolveTxt: async (name) => {
      const found = txt.get(name);
      if (!found) throw Object.assign(new Error(`queryTxt ENOTFOUND ${name}`), { code: 'ENOTFOUND' });
      return found;
    },
  });
});

after(async () => {
  await app.close();
  await ownerPool.query(`DELETE FROM app.outbox_events WHERE idempotency_key LIKE 'http-%'`);
  await removeHttpAccounts();
  await removeContentFixtures();
  await removeConsoleFixtures();
  await ownerPool.end();
  await shutdown();
});

interface Academy { id: string; slug: string; domain: string; admin: string; adminId: string }

/** A new academy, provisioned as the console does it, with a signed-in tenant admin. */
async function academy(): Promise<Academy> {
  const slug = next();
  const domain = `${slug}.academy.test`;
  const id = (await ownerPool.query<{ id: string }>(
    `INSERT INTO app.tenants (slug, name, primary_domain, brand) VALUES ($1, 'Harbour Trading', $2, '{}') RETURNING id`, [slug, domain])).rows[0]!.id;
  await ownerPool.query('INSERT INTO app.tenant_settings (tenant_id) VALUES ($1)', [id]);
  await ownerPool.query(
    `INSERT INTO app.tenant_catalogues (tenant_id, course_id, enabled, position)
     SELECT $1, id, true, row_number() OVER (ORDER BY tier, title) FROM platform.courses
      WHERE owner_tenant_id IS NULL AND review_state = 'published'`, [id]);
  forgetResolvedHosts();
  const admin = await studioMember(slug, ['tenant_admin'], 'admin');
  return { id, slug, domain, admin: (await studioLogin(app, domain, admin.email)).token!, adminId: admin.id };
}

const studio = (a: { domain: string }, token: string, method: string, url: string, payload?: Record<string, unknown>) =>
  app.inject({ method: method as 'GET', url: `/api/studio${url}`, headers: { host: a.domain, ...asStudio(token) }, ...(payload ? { payload } : {}) });

const consoleCall = (method: string, url: string, token: string, payload?: Record<string, unknown>) =>
  app.inject({ method: method as 'GET', url: `/api/console${url}`, headers: { host: CONSOLE, ...asStaff(token) }, ...(payload ? { payload } : {}) });

async function staffToken(role: 'platform_owner' | 'platform_author') {
  const member = await staffMember(role);
  const res = await consoleCall('POST', '/auth/login', '', {
    email: member.email, password: PASSWORD, ...(member.secret ? { code: totpAt(member.secret, stepOf(Date.now() / 1000)) } : {}),
  });
  return res.cookies.find((c) => c.name === 'console_session')!.value;
}

async function academyAudit(tenantId: string, action: string) {
  return (await ownerPool.query<{ payload: Record<string, unknown>; entity_id: string | null }>(
    'SELECT payload, entity_id FROM app.system_audit_log WHERE tenant_id = $1 AND action = $2 ORDER BY seq', [tenantId, action])).rows;
}

test('every stage 4 studio route is for tenant admins only', async () => {
  const a = await academy();
  const author = await studioMember(a.slug, ['author', 'reviewer', 'compliance']);
  const token = (await studioLogin(app, a.domain, author.email)).token!;
  const reads = ['/catalogue', '/learners', '/settings/brand', '/settings/review', '/settings/domain', '/settings/crm', '/outbox'];
  for (const url of reads) {
    assert.equal((await studio(a, token, 'GET', url)).statusCode, 403, url);
    assert.equal((await studio(a, a.admin, 'GET', url)).statusCode, 200, url);
    assert.equal((await app.inject({ method: 'GET', url: `/api/studio${url}`, headers: { host: a.domain } })).statusCode, 401, url);
  }
  assert.equal((await studio(a, token, 'PUT', '/settings/review', { signoffs: 3 })).statusCode, 403);
});

test('the catalogue offers published courses only, never another academy\'s, and every change is audited', async () => {
  const a = await academy();
  const listed = (await studio(a, a.admin, 'GET', '/catalogue')).json().courses as { courseId: string; source: string; enabled: boolean; title: string }[];
  assert.ok(listed.length > 0 && listed.every((c) => c.source === 'platform' && c.enabled), 'the platform courses, switched on');
  assert.ok(!listed.some((c) => c.title === 'Northgate desk rules'), 'another academy\'s private course is not listed');

  const course = listed[0]!;
  const off = await studio(a, a.admin, 'PUT', `/catalogue/${course.courseId}`, { enabled: false, position: 9 });
  assert.equal(off.statusCode, 200, off.body);
  assert.deepEqual([off.json().course.enabled, off.json().course.position], [false, 9]);
  const audit = await academyAudit(a.id, 'catalogue.changed');
  assert.deepEqual(audit.map((r) => r.payload.to), [{ enabled: false, position: 9 }]);

  const northgatePrivate = (await ownerPool.query<{ id: string }>(`SELECT id FROM platform.courses WHERE title = 'Northgate desk rules'`)).rows[0]!.id;
  assert.equal((await studio(a, a.admin, 'PUT', `/catalogue/${northgatePrivate}`, { enabled: true, position: 1 })).statusCode, 404);

  const draft = (await ownerPool.query<{ id: string }>(
    `INSERT INTO platform.courses (slug, title, tier) VALUES ($1, $1, 'learn') RETURNING id`, [next()])).rows[0]!.id;
  const refused = await studio(a, a.admin, 'PUT', `/catalogue/${draft}`, { enabled: true, position: 1 });
  assert.equal(refused.statusCode, 409);
  assert.equal(refused.json().error.code, 'not_published');
});

test('learners: literal search, keyset pages, a detail view that is audited, and another academy is 404', async () => {
  const a = await academy();
  // Enough placed learners for two pages, made directly: sign-up is tested elsewhere.
  await ownerPool.query(
    `WITH made AS (
       INSERT INTO app.users (tenant_id, email, display_name, created_at)
       SELECT $1, 'http-bulk-' || $2 || '-' || g || '@example.com', 'Bulk ' || g, now() - (g || ' minutes')::interval
         FROM generate_series(1, 27) g RETURNING id)
     INSERT INTO app.learning_paths (tenant_id, user_id) SELECT $1, id FROM made`, [a.id, process.pid]);
  const pctId = (await ownerPool.query<{ id: string }>(
    `INSERT INTO app.users (tenant_id, email, display_name) VALUES ($1, $2, '100% Trader') RETURNING id`,
    [a.id, `http-pct-${process.pid}@example.com`])).rows[0]!.id;
  // Enrolled without a placement still counts.
  await ownerPool.query(
    `INSERT INTO app.enrolments (tenant_id, user_id, course_id)
     SELECT $1, $2, id FROM platform.courses WHERE owner_tenant_id IS NULL AND review_state = 'published' LIMIT 1`, [a.id, pctId]);
  // Signed up but never started: not a learner yet.
  await ownerPool.query(
    `INSERT INTO app.users (tenant_id, email, display_name) VALUES ($1, $2, 'Not Started')`, [a.id, `http-idle-${process.pid}@example.com`]);

  const first = (await studio(a, a.admin, 'GET', '/learners')).json();
  assert.equal(first.learners.length, 25);
  assert.ok(first.next);
  assert.ok(![...first.learners].some((l: { displayName: string }) => l.displayName === 'Not Started'), 'nobody who has not started');
  const second = (await studio(a, a.admin, 'GET', `/learners?cursor=${first.next}`)).json();
  assert.equal(second.learners.length, 3);
  assert.equal(second.next, null);
  const ids = [...first.learners, ...second.learners].map((l: { id: string }) => l.id);
  assert.equal(new Set(ids).size, 28, 'no learner appears on two pages');

  const pct = (await studio(a, a.admin, 'GET', `/learners?q=${encodeURIComponent('%')}`)).json().learners;
  assert.deepEqual(pct.map((l: { displayName: string }) => l.displayName), ['100% Trader'], '% is a character, not a wildcard');
  assert.equal((await studio(a, a.admin, 'GET', '/learners?cursor=bm9wZQ')).statusCode, 400);

  const learner = await placedLearner(app, a.domain);
  const detail = await studio(a, a.admin, 'GET', `/learners/${learner.userId}`);
  assert.equal(detail.statusCode, 200, detail.body);
  assert.ok(detail.json().placement.level, 'placement is shown');
  assert.equal(detail.json().learner.email, learner.email);
  assert.deepEqual((await academyAudit(a.id, 'learner.viewed')).map((r) => r.entity_id), [learner.userId]);

  const attempts = (await studio(a, a.admin, 'GET', `/learners/${learner.userId}/attempts`)).json().attempts;
  assert.ok(attempts.some((x: { kind: string }) => x.kind === 'placement'));

  assert.equal((await studio(a, a.admin, 'GET', `/learners/${a.adminId}`)).statusCode, 404, 'an admin who has not started learning');
  assert.equal((await studio(a, a.admin, 'GET', `/learners/${a.adminId}/attempts`)).statusCode, 404);

  // A studio member who has taken a placement is a learner like anyone else.
  await ownerPool.query('INSERT INTO app.learning_paths (tenant_id, user_id) VALUES ($1, $2)', [a.id, a.adminId]);
  assert.equal((await studio(a, a.admin, 'GET', `/learners/${a.adminId}`)).statusCode, 200, 'the team\'s own test account');
  const listed = (await studio(a, a.admin, 'GET', '/learners?q=Studio%20Member')).json().learners;
  assert.deepEqual(listed.map((l: { id: string }) => l.id), [a.adminId]);
  const northgateAdmin = await studioMember('northgate', ['tenant_admin']);
  const other = (await studioLogin(app, NORTHGATE, northgateAdmin.email)).token!;
  assert.equal((await studio({ domain: NORTHGATE }, other, 'GET', `/learners/${learner.userId}`)).statusCode, 404);
  assert.equal((await studio({ domain: NORTHGATE }, other, 'GET', `/learners/${learner.userId}/attempts`)).statusCode, 404);
});

test('the brand takes the ten tokens only, refuses unreadable pairs by name, and is audited', async () => {
  const a = await academy();
  const put = (tokens: Record<string, string>) => studio(a, a.admin, 'PUT', '/settings/brand', { sub: 'Harbour', tokens });

  const unknown = await put({ '--brand': '#1A6DC2', '--font': 'Comic Sans' });
  assert.equal(unknown.statusCode, 422);
  assert.deepEqual(unknown.json().error.tokens, ['--font']);

  const invalid = await put({ '--brand': 'rgba(0,0,0,.5)', '--radius': '1em' });
  assert.equal(invalid.statusCode, 422);
  assert.deepEqual(invalid.json().error.tokens.sort(), ['--brand', '--radius']);

  assert.deepEqual(invalid.json().error.fields.map((f: { field: string }) => f.field).sort(), ['tokens.--brand', 'tokens.--radius']);
  const faint = await put({ '--ink-soft': '#BBBBBB' });
  assert.equal(faint.statusCode, 422);
  assert.equal(faint.json().error.code, 'insufficient_contrast');
  const pairs = faint.json().error.failures.map((f: { text: string; on: string }) => `${f.text} on ${f.on}`);
  assert.deepEqual(pairs, ['--ink-soft on --surface', '--ink-soft on --surface-raised']);
  assert.match(faint.json().error.message, /--ink-soft on --surface \(secondary text on the page\)/);

  const ok = await put({ '--brand': '#0B4F8A', '--radius': '12px' });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.deepEqual((await studio(a, a.admin, 'GET', '/settings/brand')).json().brand, { sub: 'Harbour', tokens: { '--brand': '#0B4F8A', '--radius': '12px' } });
  assert.equal((await academyAudit(a.id, 'settings.brand_changed')).length, 1, 'only the change that landed');

  const page = await app.inject({ method: 'GET', url: '/', headers: { host: a.domain } });
  assert.match(page.body, /#0B4F8A/, 'learners see it at once');
});

test('review sign-offs are 2 or 3, and the change is audited', async () => {
  const a = await academy();
  assert.equal((await studio(a, a.admin, 'GET', '/settings/review')).json().signoffs, 2);
  assert.equal((await studio(a, a.admin, 'PUT', '/settings/review', { signoffs: 1 })).statusCode, 400);
  assert.equal((await studio(a, a.admin, 'PUT', '/settings/review', { signoffs: 4 })).statusCode, 400);
  assert.equal((await studio(a, a.admin, 'PUT', '/settings/review', { signoffs: 3 })).statusCode, 200);
  assert.equal((await studio(a, a.admin, 'GET', '/settings/review')).json().signoffs, 3);
  assert.deepEqual((await academyAudit(a.id, 'settings.review_signoffs_changed')).map((r) => r.payload), [{ from: 2, to: 3 }]);
});

test('the CRM endpoint is https to a public host, and its secret is write-only', async () => {
  const a = await academy();
  const put = (payload: Record<string, unknown>) => studio(a, a.admin, 'PUT', '/settings/crm', payload);
  for (const url of ['http://crm.example.com/hook', 'https://localhost/hook', 'https://10.1.2.3/hook', 'https://169.254.169.254/latest',
    'https://[::1]/hook', 'https://crm/hook', 'https://user:pw@crm.example.com/hook', 'not a url']) {
    const res = await put({ url });
    assert.equal(res.statusCode, 422, url);
    assert.deepEqual(res.json().error.fields.map((f: { field: string }) => f.field), ['url'], `${url}: the refusal names the field`);
  }

  const secret = 'whsec-0123456789abcdefWXYZ';
  const saved = await put({ url: 'https://crm.example.com/hook', secret });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.deepEqual(saved.json(), { url: 'https://crm.example.com/hook', secretHint: 'WXYZ' });
  assert.ok(!saved.body.includes(secret));
  assert.ok(!(await studio(a, a.admin, 'GET', '/settings/crm')).body.includes(secret));

  // A URL change alone keeps the secret; clearing removes it.
  assert.equal((await put({ url: 'https://crm.example.com/v2' })).json().secretHint, 'WXYZ');
  assert.equal((await put({ url: 'https://crm.example.com/v2', secret: 'x'.repeat(16), clearSecret: true })).statusCode, 400);
  assert.equal((await put({ url: null, clearSecret: true })).json().secretHint, null);

  const audit = await academyAudit(a.id, 'settings.crm_changed');
  assert.deepEqual(audit.map((r) => r.payload.secret), ['replaced', 'unchanged', 'cleared']);
  assert.ok(!JSON.stringify(audit).includes(secret), 'the secret never reaches the audit log');
});

test('a domain moves only after its TXT record is found, and every step is audited', async () => {
  const a = await academy();
  const req = (domain: string) => studio(a, a.admin, 'POST', '/settings/domain', { domain });
  assert.equal((await req('not a host')).statusCode, 400);
  assert.equal((await req(CONSOLE)).statusCode, 400, 'the console host');
  assert.equal((await req(NORTHGATE)).json().error.code, 'domain_taken');
  assert.equal((await req(a.domain)).json().error.code, 'same_domain');

  const first = await req(`first.${a.domain}`);
  assert.equal(first.statusCode, 201, first.body);
  const target = `learn.${a.slug}.example.com`;
  const created = await req(target);
  const { record } = created.json().pending;
  assert.equal(record.name, `_academy-challenge.${target}`);
  assert.match(record.value, /^academy-domain-verification=[A-Za-z0-9_-]{32}$/);
  assert.equal((await academyAudit(a.id, 'domain.change_requested'))[1]!.payload.replaced, first.json().pending.id, 'a new request replaces the old');

  const missing = await studio(a, a.admin, 'POST', '/settings/domain/verify');
  assert.equal(missing.statusCode, 422);
  assert.deepEqual(missing.json().error.record, record);
  txt.set(record.name, [['academy-domain-verification=someone-else']]);
  assert.equal((await studio(a, a.admin, 'POST', '/settings/domain/verify')).statusCode, 422, 'a different token');

  // Long TXT values arrive in chunks; they are joined before comparing.
  txt.set(record.name, [['v=spf1 -all'], [record.value.slice(0, 20), record.value.slice(20)]]);
  const verified = await studio(a, a.admin, 'POST', '/settings/domain/verify');
  assert.equal(verified.statusCode, 200, verified.body);
  assert.equal(verified.json().domain, target);

  assert.equal((await app.inject({ method: 'GET', url: '/', headers: { host: target } })).statusCode, 200, 'the new host answers');
  assert.equal((await app.inject({ method: 'GET', url: '/', headers: { host: a.domain } })).statusCode, 404, 'the old one does not');
  assert.deepEqual((await academyAudit(a.id, 'domain.changed')).map((r) => r.payload), [{ from: a.domain, to: target, by: 'dns_txt' }]);
  assert.equal((await studio({ domain: target }, a.admin, 'POST', '/settings/domain/verify')).statusCode, 404, 'nothing left to verify');
});

test('a waiting domain change can be cancelled, or applied by the platform owner alone', async () => {
  const a = await academy();
  await studio(a, a.admin, 'POST', '/settings/domain', { domain: `cancel.${a.domain}` });
  assert.equal((await studio(a, a.admin, 'DELETE', '/settings/domain/pending')).statusCode, 204);
  assert.equal((await studio(a, a.admin, 'GET', '/settings/domain')).json().pending, null);
  assert.equal((await academyAudit(a.id, 'domain.change_cancelled')).length, 1);

  const owner = await staffToken('platform_owner');
  const override = (token: string) => consoleCall('POST', `/tenants/${a.id}/domain/override`, token, { reason: 'Broker cannot edit DNS this week.' });
  assert.equal((await override(owner)).json().error.code, 'no_pending_change');

  const target = `override.${a.slug}.example.com`;
  const pending = (await studio(a, a.admin, 'POST', '/settings/domain', { domain: target })).json().pending;
  assert.equal((await consoleCall('GET', `/tenants/${a.id}`, owner)).json().pendingDomain, target, 'the owner sees what was asked for');
  assert.equal((await override(await staffToken('platform_author'))).statusCode, 403);
  const done = await override(owner);
  assert.equal(done.statusCode, 200, done.body);
  assert.equal(done.json().tenant.primaryDomain, target);
  assert.equal((await app.inject({ method: 'GET', url: '/', headers: { host: target } })).statusCode, 200);

  const audit = (await ownerPool.query<{ action: string; payload: Record<string, unknown> }>(
    'SELECT action, payload FROM platform.audit_log WHERE entity_id = $1', [pending.id])).rows;
  assert.deepEqual(audit.map((r) => [r.action, r.payload.to, r.payload.reason]), [['tenant.domain_overridden', target, 'Broker cannot edit DNS this week.']]);
  const status = await ownerPool.query('SELECT status FROM app.domain_changes WHERE id = $1', [pending.id]);
  assert.equal(status.rows[0].status, 'overridden');
});

test('dead letters: the studio sees and replays its own, the console every academy\'s, and both are audited', async () => {
  const a = await academy();
  const dead = async (tenantId: string) => (await ownerPool.query<{ id: string }>(
    `INSERT INTO app.outbox_events (tenant_id, event_type, payload, idempotency_key, status, retry_count, last_error)
     VALUES ($1, 'lead.created', '{"email":"someone@example.com"}', $2, 'dead', 5, 'HTTP 500 upstream') RETURNING id`,
    [tenantId, next()])).rows[0]!.id;
  const mine = await dead(a.id);
  const theirs = await dead((await ownerPool.query<{ id: string }>(`SELECT id FROM app.tenants WHERE slug = 'northgate'`)).rows[0]!.id);

  const health = (await studio(a, a.admin, 'GET', '/outbox')).json();
  assert.equal(health.counts.dead, 1);
  assert.deepEqual(health.dead.map((d: { id: string }) => d.id), [mine]);
  assert.equal(health.dead[0].academy, 'Harbour Trading');
  assert.ok(!JSON.stringify(health).includes('someone@example.com'), 'payloads are never shown');

  assert.equal((await studio(a, a.admin, 'POST', `/outbox/${theirs}/replay`)).statusCode, 404, 'another academy\'s event');
  assert.equal((await studio(a, a.admin, 'POST', `/outbox/${mine}/replay`)).statusCode, 202);
  const row = (await ownerPool.query('SELECT status, retry_count FROM app.outbox_events WHERE id = $1', [mine])).rows[0];
  assert.notEqual(row.status, 'dead');
  assert.equal((await studio(a, a.admin, 'POST', `/outbox/${mine}/replay`)).json().error.code, 'not_dead');
  assert.deepEqual((await academyAudit(a.id, 'outbox.replayed')).map((r) => [r.entity_id, r.payload.lastError]), [[mine, 'HTTP 500 upstream']]);

  const owner = await staffToken('platform_owner');
  const all = (await consoleCall('GET', '/outbox', owner)).json();
  const seen = all.dead.find((d: { id: string }) => d.id === theirs);
  assert.equal(seen.academy, (await ownerPool.query(`SELECT name FROM app.tenants WHERE slug = 'northgate'`)).rows[0].name, 'named by academy');
  assert.equal((await consoleCall('GET', '/outbox', await staffToken('platform_author'))).statusCode, 403);
  assert.equal((await consoleCall('POST', `/outbox/${theirs}/replay`, owner)).statusCode, 202);
  const audit = await ownerPool.query<{ action: string }>('SELECT action FROM platform.audit_log WHERE entity_id = $1', [theirs]);
  assert.deepEqual(audit.rows.map((r) => r.action), ['outbox.replayed']);
});

test('a CRM delivery never reaches a loopback, private or metadata address', async () => {
  for (const ip of ['127.0.0.1', '10.0.0.1', '172.16.5.4', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0',
    '::1', '::', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', 'garbage']) {
    assert.equal(isBlockedAddress(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700::1111']) assert.equal(isBlockedAddress(ip), false, ip);
  assert.equal(isObviouslyInternalHost('crm.example.com'), false);
  assert.equal(isObviouslyInternalHost('db.internal'), true);

  const dispatcher = new HttpDispatcher(2000);
  const row = { id: 'x', tenant_id: 't', event_type: 'lead.created', payload: {}, idempotency_key: 'k', retry_count: 0, partition_key: '' };
  for (const url of ['https://127.0.0.1:9/hook', 'https://[::1]:9/hook', 'https://localhost:9/hook', 'http://crm.example.com/hook']) {
    await assert.rejects(dispatcher.send({ url, secret: null }, row), /refused/, url);
  }
});
