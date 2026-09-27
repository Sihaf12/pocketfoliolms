/**
 * A stand-in for Google in tests: a local RSA key, ID tokens signed with
 * it, and a client that answers the way the test says.
 */
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import {
  GOOGLE, GoogleUnavailableError, InvalidIdTokenError, verifyIdToken, type GoogleClient, type GoogleIdentity,
} from '../src/auth/google.js';

export const CLIENT_ID = 'test-client.apps.googleusercontent.com';
export const CLIENT_SECRET = 'test-secret';

export function testKey(kid = 'test-key') {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { kid, privateKey, jwk: { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' } };
}

export function signIdToken(claims: Record<string, unknown>, key: { kid: string; privateKey: KeyObject }, header: Record<string, unknown> = {}) {
  const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const h = enc({ alg: 'RS256', typ: 'JWT', kid: key.kid, ...header });
  const p = enc(claims);
  return `${h}.${p}.${sign('RSA-SHA256', Buffer.from(`${h}.${p}`), key.privateKey).toString('base64url')}`;
}

export interface FakePerson { sub: string; email: string; name?: string; emailVerified?: boolean }

/**
 * Plays Google for the sign-in routes. `person` is who signs in; the code
 * it hands out carries the nonce Google would have been sent.
 */
export class FakeGoogle implements GoogleClient {
  readonly key = testKey();
  person: FakePerson = { sub: 'g-1', email: 'someone@example.com' };
  down = false;
  lastAuthorize: URL | null = null;
  private nonces = new Map<string, string>();

  authorizeUrl(p: { clientId: string; redirectUri: string; state: string; challenge: string; nonce: string }): string {
    const url = new URL('https://accounts.google.test/auth');
    url.search = new URLSearchParams({ client_id: p.clientId, redirect_uri: p.redirectUri, state: p.state, code_challenge: p.challenge, code_challenge_method: 'S256', nonce: p.nonce, scope: 'openid email profile' }).toString();
    this.lastAuthorize = url;
    this.nonces.set(p.state, p.nonce);
    return url.toString();
  }

  /** The code Google would put on the callback for the last sign-in started. */
  codeFor(state: string): string {
    return `code:${this.nonces.get(state) ?? 'unknown'}`;
  }

  async exchange(p: { code: string }): Promise<string> {
    if (this.down) throw new GoogleUnavailableError('down');
    const nonce = p.code.replace(/^code:/, '');
    const now = Math.floor(Date.now() / 1000);
    return signIdToken({
      iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: this.person.sub, email: this.person.email,
      email_verified: this.person.emailVerified ?? true, name: this.person.name ?? 'Google Learner',
      nonce, iat: now, exp: now + 3600,
    }, this.key);
  }

  async verify(idToken: string, expect: { clientId: string; nonce: string }): Promise<GoogleIdentity> {
    return verifyIdToken(idToken, [this.key.jwk], { ...expect, issuers: GOOGLE.issuers });
  }
}

export { InvalidIdTokenError };
