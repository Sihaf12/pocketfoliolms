/**
 * Module 4a · TOTP and the secret box. Pure: no database.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  base32Decode, base32Encode, newTotpSecret, otpauthUri, stepOf, totpAt, verifyTotp,
} from '../src/auth/totp.js';
import { keyFrom, open, seal, SecretBoxKeyError } from '../src/auth/secretBox.js';

// RFC 6238, Appendix B: the SHA-1 secret is the ASCII "12345678901234567890".
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

test('TOTP matches the RFC 6238 test vectors', () => {
  assert.equal(RFC_SECRET, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  const vectors: [number, string][] = [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037']];
  for (const [time, code] of vectors) {
    assert.equal(totpAt(RFC_SECRET, stepOf(time), 8), code, `at ${time}`);
    assert.equal(totpAt(RFC_SECRET, stepOf(time)), code.slice(2), `six digits at ${time}`);
  }
});

test('a code is accepted within one step of drift, and only once', () => {
  const now = 1_700_000_000;
  const code = totpAt(RFC_SECRET, stepOf(now));
  const step = verifyTotp(RFC_SECRET, code, now, null);
  assert.equal(step, stepOf(now));
  assert.equal(verifyTotp(RFC_SECRET, code, now, step), null, 'the same code, replayed');
  assert.equal(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, stepOf(now) + 1), now, step), stepOf(now) + 1, 'the next step is still new');
  assert.equal(verifyTotp(RFC_SECRET, code, now + 30, null), stepOf(now), 'thirty seconds of drift');
  assert.equal(verifyTotp(RFC_SECRET, code, now + 90, null), null, 'ninety is too many');
  for (const bad of ['', '12345', '1234567', 'abcdef']) assert.equal(verifyTotp(RFC_SECRET, bad, now, null), null);
});

test('new secrets are 160 random bits, and the URI names the account', () => {
  const secret = newTotpSecret();
  assert.equal(base32Decode(secret).length, 20);
  assert.notEqual(newTotpSecret(), secret);
  assert.match(otpauthUri(secret, 'owner@example.com'), /^otpauth:\/\/totp\/Academy%20console%3Aowner%40example\.com\?secret=[A-Z2-7]+&issuer=/);
});

test('the secret box round-trips, and refuses tampering and the wrong key', () => {
  const key = keyFrom(randomBytes(32).toString('base64'));
  const sealed = seal('JBSWY3DPEHPK3PXP', key);
  assert.notEqual(sealed, seal('JBSWY3DPEHPK3PXP', key), 'a fresh nonce every time');
  assert.equal(open(sealed, key), 'JBSWY3DPEHPK3PXP');

  const raw = Buffer.from(sealed, 'base64');
  raw.writeUInt8(raw.readUInt8(raw.length - 1) ^ 1, raw.length - 1);
  assert.throws(() => open(raw.toString('base64'), key), 'a flipped bit is caught');
  assert.throws(() => open(sealed, keyFrom(randomBytes(32).toString('base64'))), 'another key cannot open it');
  assert.throws(() => keyFrom(randomBytes(16).toString('base64')), SecretBoxKeyError);
});
