/**
 * Google sign-in, the parts that talk to Google or check what it says.
 * No library: PKCE and RS256 verification are a few lines of node:crypto.
 *
 *   PKCE (RFC 7636, S256)  the verifier stays on the server; Google sees
 *                          only its hash, and must be shown the verifier
 *                          to hand over tokens
 *   the ID token           signature against Google's published keys,
 *                          then issuer, audience, expiry, our nonce, and
 *                          an email Google has verified
 *
 * The endpoints default to Google's. The end-to-end run points them at a
 * local stand-in; nothing else should change them.
 */
import { createHash, createPublicKey, randomBytes, verify, type JsonWebKey } from 'node:crypto';

export const GOOGLE_SCOPE = 'openid email profile';

export interface GoogleEndpoints {
  authorize: string;
  token: string;
  jwks: string;
  /** The `iss` an ID token must carry. Google's are both forms. */
  issuers: string[];
}

export const GOOGLE: GoogleEndpoints = {
  authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  jwks: 'https://www.googleapis.com/oauth2/v3/certs',
  issuers: ['https://accounts.google.com', 'accounts.google.com'],
};

export const randomToken = () => randomBytes(32).toString('base64url');
export const sha256 = (value: string) => createHash('sha256').update(value).digest('base64url');

/** The S256 challenge for a PKCE verifier. */
export const pkceChallenge = (verifier: string) => sha256(verifier);

export class GoogleUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleUnavailableError';
  }
}

export class InvalidIdTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidIdTokenError';
  }
}

export interface GoogleIdentity {
  /** Google's stable id for the person: sub. */
  subject: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
}

/** What the sign-in routes need from Google, so tests can stand in for it. */
export interface GoogleClient {
  /** The page Google shows the learner. */
  authorizeUrl(params: { clientId: string; redirectUri: string; state: string; challenge: string; nonce: string }): string;
  /** Code for ID token, proving the verifier. */
  exchange(params: { clientId: string; clientSecret: string; redirectUri: string; code: string; verifier: string }): Promise<string>;
  /** The ID token, checked and read. */
  verify(idToken: string, expect: { clientId: string; nonce: string }): Promise<GoogleIdentity>;
}

interface Jwk extends JsonWebKey { kid?: string }

async function fetchWithin(url: string, init: RequestInit, ms: number): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
  } catch (err) {
    throw new GoogleUnavailableError(`Google did not answer: ${(err as Error).message}`);
  }
}

const b64json = (part: string): Record<string, unknown> => {
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new InvalidIdTokenError('the token is not well formed');
  }
};

/**
 * Checks an RS256 ID token against a set of public keys and the claims we
 * expect. Separate from the network so it can be tested with local keys.
 */
export function verifyIdToken(
  idToken: string,
  keys: Jwk[],
  expect: { clientId: string; nonce: string; issuers: string[]; now?: number },
): GoogleIdentity {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new InvalidIdTokenError('the token is not well formed');
  const [h, p, s] = parts as [string, string, string];
  const header = b64json(h);
  if (header.alg !== 'RS256') throw new InvalidIdTokenError('the token is not signed with RS256');
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new InvalidIdTokenError('the token is signed with an unknown key');
  const key = createPublicKey({ key: jwk, format: 'jwk' });
  if (!verify('RSA-SHA256', Buffer.from(`${h}.${p}`), key, Buffer.from(s, 'base64url'))) {
    throw new InvalidIdTokenError('the signature does not verify');
  }

  const claims = b64json(p);
  const now = expect.now ?? Math.floor(Date.now() / 1000);
  const skew = 60;
  const aud = claims.aud;
  const audiences = Array.isArray(aud) ? aud : [aud];
  if (!expect.issuers.includes(String(claims.iss))) throw new InvalidIdTokenError('the token has the wrong issuer');
  if (!audiences.includes(expect.clientId)) throw new InvalidIdTokenError('the token is for another client');
  if (audiences.length > 1 && claims.azp !== expect.clientId) throw new InvalidIdTokenError('the token was issued to another party');
  if (typeof claims.exp !== 'number' || claims.exp + skew < now) throw new InvalidIdTokenError('the token has expired');
  if (typeof claims.iat === 'number' && claims.iat - skew > now) throw new InvalidIdTokenError('the token is from the future');
  if (claims.nonce !== expect.nonce) throw new InvalidIdTokenError('the token answers another sign-in');
  if (typeof claims.sub !== 'string' || !claims.sub) throw new InvalidIdTokenError('the token has no subject');
  if (typeof claims.email !== 'string' || !claims.email) throw new InvalidIdTokenError('the token has no email');

  return {
    subject: claims.sub,
    email: claims.email.trim().toLowerCase(),
    emailVerified: claims.email_verified === true || claims.email_verified === 'true',
    name: typeof claims.name === 'string' && claims.name.trim() ? claims.name.trim().slice(0, 100) : null,
  };
}

/** The real thing: Google's endpoints, over https, five seconds each. */
export class HttpGoogleClient implements GoogleClient {
  private keys: { list: Jwk[]; until: number } | null = null;

  constructor(private readonly endpoints: GoogleEndpoints = GOOGLE, private readonly timeoutMs = 5_000) {}

  authorizeUrl(p: { clientId: string; redirectUri: string; state: string; challenge: string; nonce: string }): string {
    const url = new URL(this.endpoints.authorize);
    url.search = new URLSearchParams({
      response_type: 'code', client_id: p.clientId, redirect_uri: p.redirectUri, scope: GOOGLE_SCOPE,
      state: p.state, code_challenge: p.challenge, code_challenge_method: 'S256', nonce: p.nonce,
      prompt: 'select_account',
    }).toString();
    return url.toString();
  }

  async exchange(p: { clientId: string; clientSecret: string; redirectUri: string; code: string; verifier: string }): Promise<string> {
    const res = await fetchWithin(this.endpoints.token, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code', code: p.code, client_id: p.clientId, client_secret: p.clientSecret,
        redirect_uri: p.redirectUri, code_verifier: p.verifier,
      }).toString(),
    }, this.timeoutMs);
    if (res.status >= 500) throw new GoogleUnavailableError(`Google's token endpoint answered ${res.status}`);
    const body = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string };
    if (!res.ok || !body.id_token) throw new InvalidIdTokenError(`the code was not accepted: ${body.error ?? res.status}`);
    return body.id_token;
  }

  private async publicKeys(refresh: boolean): Promise<Jwk[]> {
    if (!refresh && this.keys && this.keys.until > Date.now()) return this.keys.list;
    const res = await fetchWithin(this.endpoints.jwks, {}, this.timeoutMs);
    if (!res.ok) throw new GoogleUnavailableError(`Google's keys answered ${res.status}`);
    const body = (await res.json()) as { keys?: Jwk[] };
    const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1] ?? 3600);
    this.keys = { list: body.keys ?? [], until: Date.now() + Math.min(maxAge, 86_400) * 1000 };
    return this.keys.list;
  }

  async verify(idToken: string, expect: { clientId: string; nonce: string }): Promise<GoogleIdentity> {
    const expected = { ...expect, issuers: this.endpoints.issuers };
    try {
      return verifyIdToken(idToken, await this.publicKeys(false), expected);
    } catch (err) {
      // Google rotates its keys: an unknown key id is worth one fresh look.
      if (err instanceof InvalidIdTokenError && err.message.includes('unknown key')) {
        return verifyIdToken(idToken, await this.publicKeys(true), expected);
      }
      throw err;
    }
  }
}
