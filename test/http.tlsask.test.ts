/**
 * Caddy's on-demand TLS question. A certificate is asked for only when a
 * host would be served: an active academy, the console, or the Google
 * callback host. Anything else, including a suspended academy, is refused.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { shutdown } from '../src/db/unitOfWork.js';
import { buildTlsAskServer } from '../src/http/tlsAsk.js';
import { forgetResolvedHosts } from '../src/http/tenantScope.js';
import { CALLBACK, CONSOLE, NORTHGATE, SABLE, server } from './httpHarness.js';

let ask: FastifyInstance;

before(async () => {
  forgetResolvedHosts();
  ask = await buildTlsAskServer({ consoleHost: CONSOLE, callbackHost: CALLBACK });
});
after(async () => {
  await ask.close();
  await shutdown();
});

const asks = (domain: string) => ask.inject({ method: 'GET', url: `/tls/ask?domain=${encodeURIComponent(domain)}` });

test('yes for each active academy, the console host and the Google callback host', async () => {
  for (const domain of [NORTHGATE, SABLE, CONSOLE, CALLBACK]) {
    const res = await asks(domain);
    assert.equal(res.statusCode, 200, domain);
    assert.equal(res.body, 'yes');
  }
});

test('no for a stranger, a suspended academy, an address, and anything not a bare host name', async () => {
  for (const domain of [
    'learn.unknown.example', 'learn.lapsed.example', '203.0.113.9', '[::1]', 'localhost',
    `${NORTHGATE}:443`, `${NORTHGATE}.`, `evil.${NORTHGATE}`, `${NORTHGATE}/x`, '',
  ]) {
    const res = await asks(domain);
    assert.equal(res.statusCode, 404, domain || '(empty)');
    assert.equal(res.body, 'no');
  }
  assert.equal((await ask.inject({ method: 'GET', url: '/tls/ask' })).statusCode, 404, 'no domain at all');
});

test('the case Caddy sends does not matter', async () => {
  assert.equal((await asks(NORTHGATE.toUpperCase())).statusCode, 200);
});

test('with Google sign-in off, the callback host is not ours', async () => {
  const off = await buildTlsAskServer({ consoleHost: CONSOLE, callbackHost: '' });
  assert.equal((await off.inject({ method: 'GET', url: `/tls/ask?domain=${CALLBACK}` })).statusCode, 404);
  await off.close();
});

test('the question is answered nowhere else on the ask server, and not at all on the public one', async () => {
  assert.equal((await ask.inject({ method: 'GET', url: '/healthz' })).statusCode, 404);
  assert.equal((await ask.inject({ method: 'POST', url: `/tls/ask?domain=${NORTHGATE}` })).statusCode, 404);
  const app = await server();
  try {
    for (const host of [NORTHGATE, CONSOLE, CALLBACK]) {
      const res = await app.inject({ method: 'GET', url: `/tls/ask?domain=${NORTHGATE}`, headers: { host } });
      assert.equal(res.statusCode, 404, host);
    }
    const health = await app.inject({ method: 'GET', url: '/healthz', headers: { host: 'anything.example' } });
    assert.deepEqual([health.statusCode, health.json(), health.headers['cache-control']], [200, { ok: true }, 'no-store']);
  } finally {
    await app.close();
  }
});
