/**
 * One error shape for every route: { error: { code, message } }.
 * Only HttpError carries a message chosen for the client. Anything
 * unexpected becomes a 500 that says nothing about the cause.
 */
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { logger } from '../logger.js';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export interface ErrorBody {
  error: { code: string; message: string };
}

export const errorBody = (code: string, message: string): ErrorBody => ({ error: { code, message } });

const CLIENT_CODES: Record<number, string> = {
  400: 'invalid_request',
  404: 'not_found',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
  429: 'rate_limited',
};

export function handleError(err: FastifyError | Error, req: FastifyRequest, reply: FastifyReply) {
  if (err instanceof HttpError) {
    return reply.status(err.status).send(errorBody(err.code, err.message));
  }
  const status = 'statusCode' in err && typeof err.statusCode === 'number' ? err.statusCode : 500;
  if (status >= 400 && status < 500) {
    return reply.status(status).send(errorBody(CLIENT_CODES[status] ?? 'bad_request', err.message));
  }
  logger.error({ message: err.message, stack: err.stack, method: req.method, url: req.url }, 'unhandled route error');
  return reply.status(500).send(errorBody('internal', 'Something went wrong.'));
}
