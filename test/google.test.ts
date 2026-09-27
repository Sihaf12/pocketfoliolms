/** Google sign-in: PKCE and ID-token checks, against a local key. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GOOGLE, InvalidIdTokenError, pkceChallenge, verifyIdToken } from '../src/auth/google.js';
import { CLIENT_ID, signIdToken, testKey } from './googleFake.js';

test('the PKCE challenge is RFC 7636\'s S256', () => {
  assert.equal(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('an ID token is accepted only with a good signature, issuer, audience, expiry and nonce', () => {
  const key = testKey();
  const now = 1_800_000_000;
  const good = { iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: '1234', email: 'Amara@Example.com', email_verified: true, name: 'Amara Osei', nonce: 'n-1', iat: now, exp: now + 3600 };
  const expect = { clientId: CLIENT_ID, nonce: 'n-1', issuers: GOOGLE.issuers, now };
  const check = (claims: Record<string, unknown>, k = key, header: Record<string, unknown> = {}) =>
    () => verifyIdToken(signIdToken(claims, k, header), [key.jwk], expect);

  assert.deepEqual(check(good)(), { subject: '1234', email: 'amara@example.com', emailVerified: true, name: 'Amara Osei' });
  assert.equal(verifyIdToken(signIdToken({ ...good, iss: 'accounts.google.com' }, key), [key.jwk], expect).subject, '1234', 'both issuer forms');

  const refused: [string, () => unknown][] = [
    ['another client', check({ ...good, aud: 'someone-else' })],
    ['another issuer', check({ ...good, iss: 'https://evil.example' })],
    ['expired', check({ ...good, exp: now - 120 })],
    ['from the future', check({ ...good, iat: now + 600 })],
    ['another sign-in\'s nonce', check({ ...good, nonce: 'n-2' })],
    ['no subject', check({ ...good, sub: '' })],
    ['a different key', check(good, testKey('test-key'))],
    ['an unknown key id', check(good, key, { kid: 'nobody' })],
    ['not RS256', check(good, key, { alg: 'none' })],
  ];
  for (const [why, run] of refused) assert.throws(run, InvalidIdTokenError, why);
  assert.throws(() => verifyIdToken('not.a.token', [key.jwk], expect), InvalidIdTokenError, 'garbage');
  assert.throws(() => verifyIdToken(signIdToken(good, key).slice(0, -4) + 'AAAA', [key.jwk], expect), InvalidIdTokenError, 'tampered signature');

  assert.equal(check({ ...good, email_verified: false })().emailVerified, false, 'an unverified email is reported, and refused by the caller');
});
