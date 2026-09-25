/**
 * Public certificate verification. No tenant, no session: anyone holding
 * a serial can confirm who earned what and when, and learn nothing about
 * which academy issued it.
 *
 * A revoked, expired, unknown or malformed serial is one and the same
 * 404, so the response never confirms that a serial once existed.
 */
import type { FastifyInstance } from 'fastify';
import { verifyCertificate } from '../../../db/unitOfWork.js';
import { SERIAL_PATTERN } from '../../../domain/serial.js';
import { HttpError } from '../../errors.js';
import type { RouteLimit } from '../../server.js';

export async function certificateRoutes(app: FastifyInstance, opts: { limit: RouteLimit }): Promise<void> {
  app.get<{ Params: { serial: string } }>('/certificates/:serial', {
    config: { rateLimit: { max: opts.limit.max, timeWindow: opts.limit.windowMs } },
    schema: {
      params: {
        type: 'object',
        additionalProperties: false,
        required: ['serial'],
        properties: { serial: { type: 'string', maxLength: 32 } },
      },
      response: {
        200: {
          type: 'object',
          required: ['holderName', 'courseTitle', 'issuedAt'],
          properties: {
            holderName: { type: 'string' },
            courseTitle: { type: 'string' },
            issuedAt: { type: 'string' },
          },
        },
      },
    },
  }, async (req, reply) => {
    // A revocation must take effect at once, so nothing may cache the answer.
    reply.header('cache-control', 'no-store');
    const serial = req.params.serial.trim().toUpperCase();
    const certificate = SERIAL_PATTERN.test(serial) ? await verifyCertificate(serial) : null;
    if (!certificate) throw new HttpError(404, 'certificate_not_found', 'No valid certificate has this serial.');
    return {
      holderName: certificate.holderName,
      courseTitle: certificate.courseTitle,
      issuedAt: certificate.issuedAt.toISOString(),
    };
  });
}
