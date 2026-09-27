/**
 * The development cookie switch drops Secure over plain HTTP, and the
 * server refuses to start with it in production.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { shutdown } from '../src/db/unitOfWork.js';
import { buildServer, InsecureCookieInProductionError } from '../src/http/server.js';
import { NORTHGATE, PASSWORD, removeHttpAccounts, server, uniqueEmail } from './httpHarness.js';

after(async () => {
  await removeHttpAccounts();
  await shutdown();
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
