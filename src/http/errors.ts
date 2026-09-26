/**
 * One error shape for every route: { error: { code, message } }.
 * Only HttpError carries a message chosen for the client. Anything
 * unexpected becomes a 500 that says nothing about the cause.
 *
 * An error about particular fields also carries
 * fields: [{ field, message }], with field as a dotted path into the
 * request body ("videoAsset", "questions.0.prompt"), so a form can put
 * each message beside the field it is about.
 */
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { logger } from '../logger.js';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Extra fields for the client, such as the problems that stop a submission. */
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export interface FieldProblem {
  field: string;
  message: string;
}

/** An HttpError about one field of the request body. */
export function fieldError(status: number, code: string, field: string, message: string): HttpError {
  return new HttpError(status, code, message, { fields: [{ field, message }] });
}

interface SchemaProblem {
  keyword: string;
  instancePath: string;
  params: Record<string, unknown>;
}

/** A schema failure, in words a person can act on, with the field it is about. */
export function describeSchemaProblem(v: SchemaProblem): FieldProblem {
  const parts = v.instancePath.split('/').filter(Boolean);
  if (v.keyword === 'required') parts.push(String(v.params.missingProperty));
  if (v.keyword === 'additionalProperties') parts.push(String(v.params.additionalProperty));
  const field = parts.join('.');
  const n = Number(v.params.limit);
  const message = (() => {
    switch (v.keyword) {
      case 'required': return 'This is needed.';
      case 'additionalProperties': return 'This field is not accepted here.';
      case 'minLength': return n <= 1 ? 'This cannot be empty.' : `Use at least ${n} characters.`;
      case 'maxLength': return `Use at most ${n} characters.`;
      case 'minimum': return `Use ${n} or more.`;
      case 'maximum': return `Use ${n} or less.`;
      case 'minItems': return `Add at least ${n}.`;
      case 'maxItems': return `Use at most ${n}.`;
      case 'uniqueItems': return 'Each entry can appear once.';
      case 'enum': return `Choose one of: ${(v.params.allowedValues as unknown[] ?? []).join(', ')}.`;
      case 'format': return v.params.format === 'email' ? 'Give a full email address.' : 'This is not in the accepted format.';
      case 'pattern': return 'This is not in the accepted format.';
      case 'type': return v.params.type === 'integer' ? 'Use a whole number.' : 'This is not the right kind of value.';
      default: return 'This is not accepted.';
    }
  })();
  return { field, message };
}

export interface ErrorBody {
  error: { code: string; message: string } & Record<string, unknown>;
}

export const errorBody = (code: string, message: string, details: Record<string, unknown> = {}): ErrorBody =>
  ({ error: { ...details, code, message } });

const CLIENT_CODES: Record<number, string> = {
  400: 'invalid_request',
  404: 'not_found',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
  429: 'rate_limited',
};

export function handleError(err: FastifyError | Error, req: FastifyRequest, reply: FastifyReply) {
  if (err instanceof HttpError) {
    return reply.status(err.status).send(errorBody(err.code, err.message, err.details));
  }
  const status = 'statusCode' in err && typeof err.statusCode === 'number' ? err.statusCode : 500;
  const validation = (err as FastifyError).validation as SchemaProblem[] | undefined;
  if (status === 400 && validation?.length && (err as FastifyError).validationContext === 'body') {
    return reply.status(400).send(errorBody('invalid_request', 'Some of this needs changing before it can be saved.', {
      fields: validation.map(describeSchemaProblem),
    }));
  }
  if (status >= 400 && status < 500) {
    return reply.status(status).send(errorBody(CLIENT_CODES[status] ?? 'bad_request', err.message));
  }
  logger.error({ message: err.message, stack: err.stack, method: req.method, url: req.url }, 'unhandled route error');
  return reply.status(500).send(errorBody('internal', 'Something went wrong.'));
}
