/**
 * A stand-in for Google's sign-in pages, for the end-to-end run only:
 * scripts/demo.sh starts it when DEMO_FAKE_GOOGLE_PORT is set and points
 * the API at it through the GOOGLE_*_URL settings. It keeps Google's
 * rules that matter here: the redirect must be the registered one, the
 * client must prove its secret, and the code is released only to the
 * PKCE verifier whose challenge came with it, once.
 *
 *   /authorize  a page asking who signs in, with Continue and Cancel
 *   /token      code and verifier for a signed ID token
 *   /jwks       the public key
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { pkceChallenge, randomToken } from '../src/auth/google.js';
import { signIdToken, testKey } from './googleFake.js';

const port = Number(process.env.DEMO_FAKE_GOOGLE_PORT ?? 3302);
const issuer = `http://127.0.0.1:${port}`;
const clientId = process.env.GOOGLE_CLIENT_ID ?? '';
const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? '';
const registered = `http://${process.env.AUTH_CALLBACK_HOST ?? ''}/api/auth/google/callback`;
const key = testKey('e2e-key');

interface Grant { nonce: string; challenge: string; email: string; name: string; until: number }
const grants = new Map<string, Grant>();

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function send(res: ServerResponse, status: number, type: string, body: string) {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}
const back = (res: ServerResponse, to: URL) => { res.writeHead(302, { location: to.toString() }); res.end(); };

function authorizePage(q: URLSearchParams): string {
  const hidden = ['state', 'nonce', 'code_challenge', 'redirect_uri']
    .map((n) => `<input type="hidden" name="${n}" value="${esc(q.get(n) ?? '')}">`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Stand-in for Google</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family:system-ui;max-width:28rem;margin:2rem auto;padding:0 1rem">
<main><h1>Stand-in for Google</h1><p>Scope asked for: ${esc(q.get('scope') ?? '')}</p>
<form method="get" action="/decide">${hidden}
<p><label>Email <input name="email" type="email" required></label></p>
<p><label>Name <input name="name"></label></p>
<p><button name="decision" value="allow">Continue</button> <button name="decision" value="deny" formnovalidate>Cancel</button></p>
</form></main></body></html>`;
}

async function body(req: IncomingMessage): Promise<URLSearchParams> {
  let raw = '';
  for await (const chunk of req) raw += String(chunk);
  return new URLSearchParams(raw);
}

createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', issuer);
    const q = url.searchParams;
    if (url.pathname === '/authorize') {
      if (q.get('client_id') !== clientId || q.get('redirect_uri') !== registered) {
        return send(res, 400, 'text/plain', `redirect_uri_mismatch: ${q.get('redirect_uri')}`);
      }
      if (q.get('code_challenge_method') !== 'S256' || q.get('scope') !== 'openid email profile') {
        return send(res, 400, 'text/plain', 'invalid_request');
      }
      return send(res, 200, 'text/html; charset=utf-8', authorizePage(q));
    }
    if (url.pathname === '/decide') {
      const to = new URL(registered);
      to.searchParams.set('state', q.get('state') ?? '');
      if (q.get('decision') !== 'allow') {
        to.searchParams.set('error', 'access_denied');
        return back(res, to);
      }
      const code = randomToken();
      grants.set(code, {
        nonce: q.get('nonce') ?? '', challenge: q.get('code_challenge') ?? '',
        email: q.get('email') ?? '', name: q.get('name') ?? '', until: Date.now() + 60_000,
      });
      to.searchParams.set('code', code);
      return back(res, to);
    }
    if (url.pathname === '/token' && req.method === 'POST') {
      const form = await body(req);
      const code = form.get('code') ?? '';
      const grant = grants.get(code);
      grants.delete(code);
      if (form.get('client_id') !== clientId || form.get('client_secret') !== clientSecret) return send(res, 401, 'application/json', '{"error":"invalid_client"}');
      if (!grant || grant.until < Date.now() || pkceChallenge(form.get('code_verifier') ?? '') !== grant.challenge
          || form.get('redirect_uri') !== registered) {
        return send(res, 400, 'application/json', '{"error":"invalid_grant"}');
      }
      const now = Math.floor(Date.now() / 1000);
      const idToken = signIdToken({
        iss: issuer, aud: clientId, sub: `e2e:${grant.email.toLowerCase()}`, email: grant.email, email_verified: true,
        ...(grant.name ? { name: grant.name } : {}), nonce: grant.nonce, iat: now, exp: now + 3600,
      }, key);
      return send(res, 200, 'application/json', JSON.stringify({ id_token: idToken, token_type: 'Bearer' }));
    }
    if (url.pathname === '/jwks') return send(res, 200, 'application/json', JSON.stringify({ keys: [key.jwk] }));
    return send(res, 404, 'text/plain', 'not found');
  })().catch((err: unknown) => send(res, 500, 'text/plain', String(err)));
}).listen(port, '127.0.0.1', () => {
  process.stdout.write(`stand-in for Google on ${issuer}\n`);
});
