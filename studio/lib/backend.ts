/**
 * The one way this process talks to Fastify: with the host the browser
 * asked for, the address the edge server recorded, and the shared secret
 * that makes Fastify believe both. Server-side only.
 */
import 'server-only';

const BACKEND = process.env.BACKEND_URL ?? 'http://127.0.0.1:3000';
const PUBLIC_PROTO = process.env.PUBLIC_PROTO === 'http' ? 'http' : 'https';

function secret(): string {
  const value = process.env.PROXY_SECRET;
  if (!value) throw new Error('PROXY_SECRET is not set.');
  return value;
}

/** Request headers worth passing on; everything else stays here. */
const PASSED = ['accept', 'accept-language', 'content-type', 'cookie', 'origin', 'sec-fetch-site', 'user-agent', 'if-none-match'];

/** Response headers worth passing back. Set-Cookie is handled on its own. */
const RETURNED = [
  'cache-control', 'content-type', 'content-security-policy', 'etag', 'location', 'referrer-policy', 'retry-after',
  'x-content-type-options', 'x-frame-options', 'vary',
];

export interface From {
  host: string;
  ip: string;
  headers?: Headers;
}

export function signedHeaders(from: From): Headers {
  const out = new Headers();
  for (const name of PASSED) {
    const value = from.headers?.get(name);
    if (value !== null && value !== undefined) out.set(name, value);
  }
  out.set('x-forwarded-host', from.host);
  out.set('x-forwarded-for', from.ip);
  out.set('x-forwarded-proto', PUBLIC_PROTO);
  out.set('x-academy-proxy-secret', secret());
  return out;
}

/** Forwards a browser request to the same path on Fastify and relays the answer. */
export async function forward(request: Request, path: string): Promise<Response> {
  const incoming = new URL(request.url);
  const target = new URL(path + incoming.search, BACKEND);
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const res = await fetch(target, {
    method: request.method,
    headers: signedHeaders({
      host: request.headers.get('host') ?? '',
      ip: request.headers.get('x-forwarded-for') ?? '',
      headers: request.headers,
    }),
    body: hasBody ? await request.arrayBuffer() : undefined,
    redirect: 'manual',
    cache: 'no-store',
  });
  const headers = new Headers();
  for (const name of RETURNED) {
    const value = res.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  for (const cookie of res.headers.getSetCookie()) headers.append('set-cookie', cookie);
  return new Response(request.method === 'HEAD' || res.status === 204 ? null : res.body, { status: res.status, headers });
}

/** A server-side read, as the browser that asked for this page. */
export async function backendJson<T>(path: string, from: From): Promise<{ status: number; body: T | null }> {
  const res = await fetch(new URL(path, BACKEND), { headers: signedHeaders(from), cache: 'no-store' });
  const body = res.headers.get('content-type')?.startsWith('application/json') ? (await res.json()) as T : null;
  return { status: res.status, body };
}
