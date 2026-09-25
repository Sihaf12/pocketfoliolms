/**
 * Module 3 · public certificate verification and rate limiting.
 * Verification needs no academy and reveals none; revoked, expired and
 * unknown serials look identical; and brute force meets a per-IP limit.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { shutdown, withControl } from '../src/db/unitOfWork.js';
import { SERIAL_PATTERN, newCertificateSerial } from '../src/domain/serial.js';
import { NORTHGATE, PASSWORD, asLearner, removeHttpAccounts, server, signup, uniqueEmail } from './httpHarness.js';

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

const verify = (serial: string, host = 'learn.unknown.example', target = app, remoteAddress = '203.0.113.7') =>
  target.inject({ method: 'GET', url: `/api/v1/certificates/${encodeURIComponent(serial)}`, headers: { host }, remoteAddress });

test('a valid certificate verifies with exactly three fields and no academy', async () => {
  const issuedAt = await withControl(async (c) =>
    (await c.query<{ issued_at: Date }>(`SELECT issued_at FROM app.certificates WHERE serial = 'PA-7K3M-9QXD'`)).rows[0]!.issued_at);
  const res = await verify('PA-7K3M-9QXD');
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), {
    holderName: 'Amara',
    courseTitle: 'How markets work',
    issuedAt: issuedAt.toISOString(),
  });
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('verification needs no academy host and ignores any session', async () => {
  const { token } = await signup(app, NORTHGATE);
  for (const host of ['learn.unknown.example', NORTHGATE, 'training.sablewealth.io']) {
    const res = await app.inject({
      method: 'GET', url: '/api/v1/certificates/PA-7K3M-9QXD', headers: { host, ...asLearner(token) },
    });
    assert.equal(res.statusCode, 200, host);
    assert.deepEqual(Object.keys(res.json()).sort(), ['courseTitle', 'holderName', 'issuedAt'], host);
  }
});

test('a serial typed in lower case still verifies', async () => {
  assert.equal((await verify('pa-7k3m-9qxd')).statusCode, 200);
});

test('revoked, expired, unknown and malformed serials are one and the same 404', async () => {
  const bodies = new Set<string>();
  for (const serial of ['PA-R2V8-HC4N', 'PA-W6TJ-P0YB', 'PA-0000-0000', 'PA-1', 'PA-%', "PA-7K3M-9QXD' OR '1'='1"]) {
    const res = await verify(serial);
    assert.equal(res.statusCode, 404, serial);
    bodies.add(res.body);
  }
  assert.equal(bodies.size, 1, 'nothing tells a revoked certificate from one that never existed');
});

test('verification is rate limited per IP', async () => {
  const limited = await server({ limits: { certificates: { max: 3, windowMs: 60_000 } } });
  try {
    for (let i = 0; i < 3; i++) assert.equal((await verify('PA-0000-0000', undefined, limited)).statusCode, 404);
    const blocked = await verify('PA-7K3M-9QXD', undefined, limited);
    assert.equal(blocked.statusCode, 429, 'even a valid serial is refused past the limit');
    assert.equal(blocked.json().error.code, 'rate_limited');
    assert.ok(Number(blocked.headers['retry-after']) > 0);

    const elsewhere = await verify('PA-7K3M-9QXD', undefined, limited, '198.51.100.20');
    assert.equal(elsewhere.statusCode, 200, 'another IP has its own allowance');
  } finally {
    await limited.close();
  }
});

test('login is rate limited per IP', async () => {
  const limited = await server({ limits: { login: { max: 2, windowMs: 60_000 } } });
  try {
    const { email } = await signup(limited, NORTHGATE);
    const attempt = (password: string) => limited.inject({
      method: 'POST', url: '/api/v1/auth/login', headers: { host: NORTHGATE }, remoteAddress: '203.0.113.9',
      payload: { email, password },
    });
    assert.equal((await attempt('wrong password one')).statusCode, 401);
    assert.equal((await attempt('wrong password two')).statusCode, 401);
    const blocked = await attempt(PASSWORD);
    assert.equal(blocked.statusCode, 429, 'the right password does not get through once the limit is hit');
    assert.equal(blocked.json().error.code, 'rate_limited');
  } finally {
    await limited.close();
  }
});

test('serials are PA-XXXX-XXXX, random, and accepted by the database', async () => {
  const drawn = new Set<string>();
  for (let i = 0; i < 2000; i++) {
    const serial = newCertificateSerial();
    assert.match(serial, SERIAL_PATTERN);
    assert.doesNotMatch(serial, /[ILOU]/);
    drawn.add(serial);
  }
  assert.equal(drawn.size, 2000, 'no repeats across 2000 draws');

  const serial = newCertificateSerial();
  await withControl(async (c) => {
    await c.query('BEGIN');
    try {
      await c.query(
        `INSERT INTO app.certificates (tenant_id, user_id, course_id, serial, holder_name, course_title)
         SELECT u.tenant_id, u.id, co.id, $1, 'Check', 'Check'
           FROM app.users u, platform.courses co
          WHERE u.email = 'lena@example.com' AND co.slug = 'how-markets-work'`,
        [serial],
      );
    } finally {
      await c.query('ROLLBACK');
    }
  });
});

test('sign-up is not caught by the login limit', async () => {
  const limited = await server({ limits: { login: { max: 1, windowMs: 60_000 } } });
  try {
    for (let i = 0; i < 3; i++) {
      const res = await limited.inject({
        method: 'POST', url: '/api/v1/auth/signup', headers: { host: NORTHGATE }, remoteAddress: '203.0.113.10',
        payload: { email: uniqueEmail('limit'), password: PASSWORD, displayName: 'Limit' },
      });
      assert.equal(res.statusCode, 201);
    }
  } finally {
    await limited.close();
  }
});
