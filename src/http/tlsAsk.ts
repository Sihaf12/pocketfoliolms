/**
 * Caddy's question before it asks Let's Encrypt for a certificate: is this
 * host ours? Yes for an active academy's domain, the console's host and
 * the Google callback host; no for anything else, so a stranger pointing a
 * name at the server cannot make it issue certificates.
 *
 * A server of its own, on an internal port Caddy alone can reach, so the
 * question is never answerable from the public side. Academies are looked
 * up the way the tenant scope looks them up, cache included: a host gets a
 * certificate exactly when it would be served as an academy.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { normaliseHost, tenantFor } from './tenantScope.js';

export interface TlsAskOptions {
  consoleHost: string;
  /** The Google callback host, or empty when Google sign-in is off. */
  callbackHost: string;
}

const hostOnly = (h: string) => h.trim().toLowerCase().replace(/:\d+$/, '');

export async function buildTlsAskServer(opts: TlsAskOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, trustProxy: false });
  const fixed = new Set([opts.consoleHost, opts.callbackHost].map(hostOnly).filter(Boolean));

  app.get<{ Querystring: { domain?: string } }>('/tls/ask', async (req, reply) => {
    const raw = req.query.domain ?? '';
    const host = normaliseHost(raw);
    // Caddy sends the bare server name: anything with a port, a trailing
    // dot or another shape is not one of ours.
    const ours = host !== null && host === raw.toLowerCase() && (fixed.has(host) || (await tenantFor(host)) !== null);
    return reply.status(ours ? 200 : 404).type('text/plain').send(ours ? 'yes' : 'no');
  });
  app.setNotFoundHandler((_req, reply) => reply.status(404).type('text/plain').send('no'));
  return app;
}
