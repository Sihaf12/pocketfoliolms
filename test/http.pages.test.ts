/**
 * Demo wiring · stage 3. The academy page is served per host with that
 * academy's brand, and nothing an operator types into a brand can reach
 * the page as markup. The verification page is public and neutral. The
 * development cookie switch works, and refuses production.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { shutdown, withControl } from '../src/db/unitOfWork.js';
import { buildServer, InsecureCookieInProductionError } from '../src/http/server.js';
import { jsonForHtml, sanitiseBrand } from '../src/http/brand.js';
import { NORTHGATE, PASSWORD, SABLE, removeHttpAccounts, server, uniqueEmail } from './httpHarness.js';

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

const page = (host: string, url = '/') => app.inject({ method: 'GET', url, headers: { host } });
const tokensBlock = (body: string) => /<style id="academy-tokens">([^<]*)<\/style>/.exec(body)?.[1] ?? '';
const academyJson = (body: string) =>
  JSON.parse(/<script id="academy" type="application\/json">([^<]*)<\/script>/.exec(body)?.[1] ?? 'null');

test('each academy host gets the client with its own brand tokens and name', async () => {
  const north = await page(NORTHGATE);
  assert.equal(north.statusCode, 200);
  assert.match(String(north.headers['content-type']), /^text\/html/);
  assert.match(north.body, /<title>Pocketfolio Academy: solution prototype<\/title>/);
  assert.equal(tokensBlock(north.body), ':root{--brand:#1A6DC2;--accent:#F5C400}');
  assert.deepEqual(academyJson(north.body), { name: 'Northgate Markets', sub: 'Northgate test academy' });
  assert.doesNotMatch(north.body, /data-mode/, 'a dark academy is a token set, not a mode');

  const sable = await page(SABLE);
  assert.equal(tokensBlock(sable.body), ':root{--brand:#6B3F7A;--radius:10px}');
  assert.equal(academyJson(sable.body).name, 'Sable Wealth');
});

test('the academy page is private, uncacheable and locked down by CSP', async () => {
  const res = await page(NORTHGATE);
  assert.equal(res.headers['cache-control'], 'private, no-store');
  const csp = String(res.headers['content-security-policy']);
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /connect-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
});

test('an unknown host gets no page', async () => {
  const res = await page('learn.unknown.example');
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error.code, 'unknown_academy');
});

test('nothing in a brand can reach the page as markup', async () => {
  const original = await withControl(async (c) =>
    (await c.query<{ brand: unknown }>(`SELECT brand FROM app.tenants WHERE slug = 'northgate'`)).rows[0]!.brand);
  const hostile = {
    sub: '</script><script>alert(1)</script>',
    tokens: {
      '--brand': 'red;}</style><script>alert(2)</script>',
      '--evil': '#000000',
      '--radius': '10px;background:url(https://tracker.example)',
      '--ink-soft': '#5D6D8580',
      '--accent': '#FFFFFF',
    },
  };
  await withControl((c) => c.query(`UPDATE app.tenants SET brand = $1 WHERE slug = 'northgate'`, [hostile]));
  try {
    const res = await page(NORTHGATE);
    assert.equal(res.statusCode, 200);
    assert.equal(tokensBlock(res.body), ':root{--accent:#FFFFFF}', 'only the well-formed, known token survives');
    assert.doesNotMatch(res.body, /<script>alert/, 'no injected script element');
    assert.doesNotMatch(res.body, /<\/style><script>/, 'no token closed the style element');
    assert.doesNotMatch(res.body, /tracker\.example/);
    assert.doesNotMatch(res.body, /#5D6D8580/, 'a colour with alpha is refused: its contrast cannot be judged');
    assert.match(res.body, /\\u003c\/script\\u003e/, 'markup in the sub is escaped inside the JSON');
    assert.equal(academyJson(res.body).sub, hostile.sub, 'and still reads back as the text it was');
  } finally {
    await withControl((c) => c.query(`UPDATE app.tenants SET brand = $1 WHERE slug = 'northgate'`, [original]));
  }
});

test('the brand sanitiser keeps known tokens with valid values and reports the rest', () => {
  const b = sanitiseBrand({ sub: 'Ok', tokens: { '--brand': '#abc', '--radius': '7px', '--surface': 'blue', '--r-s': '7px', '--x': '#fff' } });
  assert.deepEqual(b.tokens, { '--brand': '#abc', '--radius': '7px' });
  assert.deepEqual(b.refused.sort(), ['--r-s', '--surface', '--x'], 'legacy names, bad values and unknown names are all refused');
  assert.deepEqual(sanitiseBrand('not an object'), { sub: '', tokens: {}, refused: [] });
  assert.equal(jsonForHtml({ s: '</script>&\u2028' }), '{"s":"\\u003c/script\\u003e\\u0026\\u2028"}');
});

test('the verification page is public, neutral and fetches rather than renders', async () => {
  for (const host of ['anyone.example', NORTHGATE]) {
    const res = await page(host, '/verify/PA-7K3M-9QXD');
    assert.equal(res.statusCode, 200, host);
    assert.match(String(res.headers['content-type']), /^text\/html/);
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.match(String(res.headers['content-security-policy']), /connect-src 'self'/);
    assert.match(res.body, /\/api\/v1\/certificates\//);
    assert.doesNotMatch(res.body, /Amara/, 'no certificate data is rendered on the server');
    assert.doesNotMatch(res.body, /Northgate/, 'no academy is named');
  }
  assert.equal((await page('anyone.example', `/verify/${'X'.repeat(40)}`)).statusCode, 400);
});

test('the development cookie switch drops Secure, and refuses to start in production', async () => {
  const saved = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    await assert.rejects(buildServer({ insecureDevCookie: true }), InsecureCookieInProductionError);
    const prod = await buildServer({});
    await prod.close();

    process.env.NODE_ENV = 'development';
    const dev = await server({ insecureDevCookie: true });
    try {
      const res = await dev.inject({
        method: 'POST', url: '/api/v1/auth/signup', headers: { host: NORTHGATE },
        payload: { email: uniqueEmail('devcookie'), password: PASSWORD, displayName: 'Dev' },
      });
      const cookie = res.cookies.find((c) => c.name === 'session')!;
      assert.equal(cookie.secure, undefined, 'no Secure attribute under the switch');
      assert.equal(cookie.httpOnly, true, 'still HttpOnly');
      assert.equal(cookie.domain, undefined, 'still host-only');
    } finally {
      await dev.close();
    }
  } finally {
    if (saved === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = saved;
  }
});
