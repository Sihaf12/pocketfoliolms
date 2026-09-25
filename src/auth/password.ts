/**
 * Password hashing with scrypt from node:crypto.
 *
 * Stored as scrypt$N$r$p$salt$key so the cost can be raised later without
 * breaking existing hashes. Verification always does the full work, even
 * for an unknown email, so response time does not reveal which emails
 * hold an account.
 */
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const PARAMS = { N: 16_384, r: 8, p: 1, keylen: 64 } as const;
const MAXMEM = 64 * 1024 * 1024;

function derive(password: string, salt: Buffer, N: number, r: number, p: number, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, { N, r, p, maxmem: MAXMEM }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, PARAMS.N, PARAMS.r, PARAMS.p, PARAMS.keylen);
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

let dummy: Promise<string> | undefined;

/** False for a wrong password, a missing hash or a malformed one. */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  dummy ??= hashPassword('no account holds this password');
  const candidate = stored ?? (await dummy);
  const parts = candidate.split('$');
  const [scheme, n, r, p, salt, key] = parts;
  if (parts.length !== 6 || scheme !== 'scrypt' || !n || !r || !p || !salt || !key) {
    await derive(password, randomBytes(16), PARAMS.N, PARAMS.r, PARAMS.p, PARAMS.keylen);
    return false;
  }
  const expected = Buffer.from(key, 'base64url');
  const actual = await derive(password, Buffer.from(salt, 'base64url'), Number(n), Number(r), Number(p), expected.length);
  return stored !== null && timingSafeEqual(actual, expected);
}
