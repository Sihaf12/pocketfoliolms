/**
 * The two HTML pages.
 *
 *   GET /                 the academy client, in the tenant scope, with
 *                         the academy's brand tokens injected
 *   GET /verify/:serial   the public verification page, in the public
 *                         scope, which reads the serial from its own URL
 *                         and asks the verification route
 *
 * Both are read from disk once, at build. Neither renders learner data on
 * the server: the client fetches what it shows.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { logger } from '../../logger.js';
import { brandPage, sanitiseBrand } from '../brand.js';
import { inAcademy } from '../context.js';
import { HttpError } from '../errors.js';

const ACADEMY_CSP = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const VERIFY_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

function html(reply: FastifyReply, csp: string, body: string) {
  return reply
    .type('text/html; charset=utf-8')
    .header('content-security-policy', csp)
    .header('x-content-type-options', 'nosniff')
    .header('referrer-policy', 'same-origin')
    .send(body);
}

const unavailable = () => new HttpError(503, 'client_unavailable', 'The academy page is not installed on this server.');

export async function academyPage(app: FastifyInstance, opts: { page: string | null }): Promise<void> {
  app.get('/', async (req, reply) => {
    if (!opts.page) throw unavailable();
    const academy = await inAcademy(req, (db) =>
      db.maybeOne<{ name: string; brand: unknown }>('SELECT name, brand FROM app.current_tenant_brand()'));
    if (!academy) throw new HttpError(404, 'unknown_academy', 'No academy is served at this address.');

    const brand = sanitiseBrand(academy.brand);
    if (brand.refused.length > 0) {
      logger.warn({ tenantId: req.tenantId, refused: brand.refused }, 'brand tokens refused');
    }
    return html(reply, ACADEMY_CSP, brandPage(opts.page, academy.name, brand));
  });
}

export async function verifyPage(app: FastifyInstance, opts: { page: string | null }): Promise<void> {
  app.get<{ Params: { serial: string } }>('/verify/:serial', {
    schema: {
      params: {
        type: 'object',
        additionalProperties: false,
        required: ['serial'],
        properties: { serial: { type: 'string', maxLength: 32 } },
      },
    },
  }, async (_req, reply) => {
    if (!opts.page) throw unavailable();
    reply.header('cache-control', 'no-store');
    return html(reply, VERIFY_CSP, opts.page);
  });
}
