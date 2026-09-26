/**
 * Module 3 · tenant resolution. The host, and only the host, decides the
 * academy, and anything that is not exactly an active academy's domain
 * is turned away rather than routed somewhere.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { requestPool, shutdown, withControl } from '../src/db/unitOfWork.js';
import { normaliseHost } from '../src/http/tenantScope.js';
import {
  CONSOLE, NORTHGATE, PASSWORD, SABLE, TEST_TOTP_KEY, removeHttpAccounts, server, tenantId, uniqueEmail,
} from './httpHarness.js';
import { ConsoleHostIsAnAcademyError } from '../src/http/server.js';

let app: FastifyInstance;
let northgate = '';

before(async () => {
  await removeHttpAccounts();
  app = await server();
  northgate = await tenantId('northgate');
});

after(async () => {
  await app.close();
  await removeHttpAccounts();
  await shutdown();
});

function signupAt(host: string, headers: Record<string, string> = {}, target: FastifyInstance = app) {
  return target.inject({
    method: 'POST',
    url: '/api/v1/auth/signup',
    headers: { host, ...headers },
    payload: { email: uniqueEmail('tenant'), password: PASSWORD, displayName: 'Tenant Test' },
  });
}

async function tenantOfUser(userId: string): Promise<string | undefined> {
  return withControl(async (c) =>
    (await c.query<{ tenant_id: string }>('SELECT tenant_id FROM app.users WHERE id = $1', [userId])).rows[0]?.tenant_id);
}

test('host normalisation strips case, port and trailing dot, and rejects what is not a hostname', () => {
  assert.equal(normaliseHost('LEARN.Northgate.AE'), 'learn.northgate.ae');
  assert.equal(normaliseHost('learn.northgate.ae:8443'), 'learn.northgate.ae');
  assert.equal(normaliseHost('learn.northgate.ae.'), 'learn.northgate.ae');
  for (const bad of [undefined, '', 'localhost', '[::1]:80', 'learn.northgate.ae:abc', 'a..b', '-x.example', 'x.example/evil', '%']) {
    assert.equal(normaliseHost(bad), null, `should reject ${String(bad)}`);
  }
});

test('an unknown host is refused, never routed to a default academy', async () => {
  const res = await signupAt('learn.unknown.example');
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error.code, 'unknown_academy');
});

test('lookalike and parent hosts are refused', async () => {
  for (const host of ['learn.northgate.ae.evil.example', 'evil-learn.northgate.ae', 'northgate.ae', '127.0.0.1']) {
    const res = await signupAt(host);
    assert.equal(res.statusCode, 404, host);
    assert.equal(res.json().error.code, 'unknown_academy', host);
  }
});

test('a suspended academy is refused', async () => {
  const res = await signupAt('learn.lapsed.example');
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error.code, 'unknown_academy');
});

test('case, port and trailing-dot variants reach the same academy', async () => {
  for (const host of ['LEARN.NORTHGATE.AE', 'learn.northgate.ae:8443', 'learn.northgate.ae.']) {
    const res = await signupAt(host);
    assert.equal(res.statusCode, 201, host);
    assert.equal(await tenantOfUser(res.json().user.id), northgate, host);
  }
});

test('forwarded headers are refused unless they come with the front end\'s secret', async () => {
  const smuggled = await signupAt('learn.unknown.example', { 'x-forwarded-host': NORTHGATE });
  assert.equal(smuggled.statusCode, 400, 'no secret: refused outright, not quietly ignored');
  assert.equal(smuggled.json().error.code, 'forwarding_refused');

  const sideways = await signupAt(NORTHGATE, { 'x-forwarded-host': SABLE });
  assert.equal(sideways.statusCode, 400, 'even on a real academy host');
  assert.equal((await signupAt(NORTHGATE, { 'x-forwarded-for': '203.0.113.1' })).statusCode, 400,
    'any forwarded header counts, not just the host');

  const secret = 'a-shared-secret-long-enough-to-matter-1234';
  const fronted = await server({ proxySecret: secret });
  try {
    const res = await signupAt('internal.backend', { 'x-forwarded-host': NORTHGATE, 'x-academy-proxy-secret': secret }, fronted);
    assert.equal(res.statusCode, 201, 'with the secret, the forwarded host decides the academy');
    assert.equal(await tenantOfUser(res.json().user.id), northgate);

    const wrong = await signupAt('internal.backend', { 'x-forwarded-host': NORTHGATE, 'x-academy-proxy-secret': secret + 'x' }, fronted);
    assert.equal(wrong.statusCode, 400, 'a wrong secret is no secret');
    const truncated = await signupAt('internal.backend', { 'x-forwarded-host': NORTHGATE, 'x-academy-proxy-secret': secret.slice(0, 10) }, fronted);
    assert.equal(truncated.statusCode, 400);

    const direct = await signupAt(NORTHGATE, {}, fronted);
    assert.equal(direct.statusCode, 201, 'a request with no forwarded headers still uses its Host');
  } finally {
    await fronted.close();
  }
});

test('a tenant id in the body is rejected, not used', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/signup',
    headers: { host: NORTHGATE },
    payload: { email: uniqueEmail('smuggle'), password: PASSWORD, displayName: 'X', tenant_id: northgate },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, 'invalid_request');
});

test('every route sits in exactly one scope: public, academy, or console', async () => {
  const PUBLIC = new Set([
    'GET /api/v1/certificates/:serial', 'HEAD /api/v1/certificates/:serial',
    'GET /verify/:serial', 'HEAD /verify/:serial',
  ]);
  const isConsole = (url: string) => url.startsWith('/api/console');
  assert.ok(app.routeList.some((r) => isConsole(r.url)), 'the console is registered');
  assert.ok(app.routeList.some((r) => r.url.startsWith('/api/studio')), 'the studio is registered');

  const probe = (method: string, url: string, host: string) => app.inject({
    method: method as 'GET',
    url: url.replace(/:[A-Za-z]+/g, '00000000-0000-0000-0000-000000000000'),
    headers: { host },
  });
  // HEAD responses carry the headers of the GET but no body to read.
  const codeOf = (res: Awaited<ReturnType<typeof probe>>) =>
    res.body && String(res.headers['content-type']).startsWith('application/json') ? res.json().error?.code : undefined;

  for (const { method, url } of app.routeList) {
    const key = `${method} ${url}`;
    for (const host of ['learn.unknown.example', NORTHGATE, CONSOLE]) {
      const res = await probe(method, url, host);
      const where = `${key} on ${host}`;
      if (PUBLIC.has(key)) {
        assert.notEqual(codeOf(res), 'unknown_academy', `${where}: public routes need no academy`);
      } else if (isConsole(url)) {
        if (host !== CONSOLE) {
          assert.equal(res.statusCode, 404, where);
          if (method !== 'HEAD') assert.equal(codeOf(res), 'not_found', `${where}: the console does not exist here`);
        }
      } else if (host !== NORTHGATE) {
        assert.equal(res.statusCode, 404, where);
        if (method !== 'HEAD') assert.equal(codeOf(res), 'unknown_academy', `${where}: academy routes need an academy host`);
      }
    }
  }
});

test('the server refuses to start if the console host is an academy\'s domain', async () => {
  await assert.rejects(server({ console: { host: NORTHGATE, totpKey: TEST_TOTP_KEY } }), ConsoleHostIsAnAcademyError);
});

/** Counts request-pool checkouts: for a host that resolves to nothing, each one is a resolver query. */
function countLookups() {
  let count = 0;
  const onAcquire = () => { count += 1; };
  requestPool.on('acquire', onAcquire);
  return { get count() { return count; }, stop: () => { requestPool.off('acquire', onAcquire); } };
}

const madeUpHost = (label: string) => `${label}-${randomUUID().slice(0, 8)}.example`;

test('a spray of unknown hosts is rate limited before it reaches the database', async () => {
  const limited = await server({ limits: { tenant: { max: 5, windowMs: 60_000 } } });
  const lookups = countLookups();
  try {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await limited.inject({
        method: 'POST', url: '/api/v1/auth/login', remoteAddress: '203.0.113.50',
        headers: { host: madeUpHost(`spray-${i}`) }, payload: { email: 'x@example.com', password: 'x' },
      });
      statuses.push(res.statusCode);
      if (res.statusCode === 429) {
        assert.equal(res.json().error.code, 'rate_limited');
        assert.ok(Number(res.headers['retry-after']) > 0);
      }
    }
    assert.deepEqual(statuses, [404, 404, 404, 404, 404, 429, 429, 429, 429, 429, 429, 429]);
    assert.equal(lookups.count, 5, 'only the requests inside the limit reached the resolver');

    const neighbour = await limited.inject({
      method: 'POST', url: '/api/v1/auth/signup', remoteAddress: '198.51.100.60', headers: { host: NORTHGATE },
      payload: { email: uniqueEmail('neighbour'), password: PASSWORD, displayName: 'Neighbour' },
    });
    assert.equal(neighbour.statusCode, 201, 'another IP is unaffected');
  } finally {
    lookups.stop();
    await limited.close();
  }
});

test('an unknown host is remembered, so repeating it does not query the database each time', async () => {
  const host = madeUpHost('repeat');
  const lookups = countLookups();
  try {
    for (let i = 0; i < 10; i++) {
      const res = await signupAt(host);
      assert.equal(res.statusCode, 404);
      assert.equal(res.json().error.code, 'unknown_academy');
    }
    assert.equal(lookups.count, 1, 'one lookup, then answered from the negative cache');
  } finally {
    lookups.stop();
  }
});

test('tenant responses are never cacheable by a shared cache', async () => {
  const res = await signupAt(NORTHGATE);
  assert.equal(res.headers['cache-control'], 'private, no-store');
  assert.match(String(res.headers.vary), /Host/);
});
