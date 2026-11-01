import Fastify, { type FastifyError, type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Execution } from '../application/idempotency.js';
import type { LedgerService } from '../application/ledger-service.js';
import { LedgerError } from '../domain/errors.js';

const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const HTTP_UNPROCESSABLE = 422;
const HTTP_INTERNAL_ERROR = 500;

/** Business error code to HTTP status. Anything unlisted is a 500. */
const STATUS_BY_CODE: Readonly<Record<string, number>> = {
  bad_request: HTTP_BAD_REQUEST,
  invalid_amount: HTTP_BAD_REQUEST,
  invalid_ttl: HTTP_BAD_REQUEST,
  account_not_found: HTTP_NOT_FOUND,
  reservation_not_found: HTTP_NOT_FOUND,
  idempotency_key_conflict: HTTP_CONFLICT,
  invalid_transition: HTTP_CONFLICT,
  reservation_expired: HTTP_CONFLICT,
  insufficient_funds: HTTP_UNPROCESSABLE,
  capture_exceeds_reservation: HTTP_UNPROCESSABLE,
};

const accountId = z.string().regex(
  /^[\w-]{1,64}$/,
  'letters, digits, "_" or "-", up to 64',
);

const amount = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

const accountParams = z.object({ id: accountId });
const reservationParams = z.object({ id: z.uuid() });
const creditBody = z.object({ amount }).strict();
const captureBody = z.object({ amount }).strict();
const releaseBody = z.object({}).strict().optional();

const reserveBody = z.object({
  accountId,
  amount,
  ttlSeconds: z.number().int().positive().optional(),
}).strict();

const idempotencyHeaders = z.object({
  'idempotency-key': z
    .string({ error: 'the Idempotency-Key header is required' })
    .regex(
      /^[\x21-\x7E]{1,255}$/,
      'Idempotency-Key must be 1 to 255 visible ASCII characters',
    ),
});

/** A request the HTTP layer refuses before it reaches the service. */
class BadRequest extends LedgerError {
  readonly code = 'bad_request';
}

function idempotencyKey(request: FastifyRequest): string {
  return idempotencyHeaders.parse(request.headers)['idempotency-key'];
}

function statusOf(code: string): number {
  return STATUS_BY_CODE[code] ?? HTTP_INTERNAL_ERROR;
}

/** Writes an execution. The same outcome always produces the same response. */
function reply<T>(
  res: FastifyReply,
  execution: Execution<T>,
  successStatus: number,
): FastifyReply {
  if (execution.replayed) {
    void res.header(
      'Idempotent-Replayed',
      'true',
    );
  }

  const { outcome } = execution;

  return outcome.ok
    ? res.code(successStatus).send(outcome.value)
    : res.code(statusOf(outcome.error.code)).send({ error: outcome.error });
}

function sendError(
  res: FastifyReply,
  error: LedgerError,
): FastifyReply {
  return res.code(statusOf(error.code)).send({ error: error.toJSON() });
}

/** Maps every error a route can raise to the one error shape clients see. */
function handleError(
  error: FastifyError,
  request: FastifyRequest,
  res: FastifyReply,
): FastifyReply {
  if (error instanceof z.ZodError) {
    const message = error.issues
      .map((issue) => `${issue.path.join('.') || 'request'}: ${issue.message}`)
      .join('; ');

    return sendError(
      res,
      new BadRequest(message),
    );
  }

  if (error instanceof LedgerError) {
    return sendError(
      res,
      error,
    );
  }

  // Fastify's own client errors: malformed JSON, wrong content type, body too large.
  if (
    typeof error.statusCode === 'number'
    && error.statusCode >= HTTP_BAD_REQUEST
    && error.statusCode < HTTP_INTERNAL_ERROR
  ) {
    return res.code(error.statusCode).send({ error: new BadRequest(error.message).toJSON() });
  }

  request.log.error(error);

  return res.code(HTTP_INTERNAL_ERROR).send({
    error: {
      code: 'internal_error',
      message: 'internal error',
      details: {},
    },
  });
}

/** Options of {@link buildApp}. */
export interface AppOptions {
  /** Turns on Fastify's request log. */
  logger?: boolean;
}

/**
 * Builds the HTTP API over a {@link LedgerService}.
 *
 * @remarks
 * Every POST requires an `Idempotency-Key` header. Responses replayed from a
 * stored outcome carry `Idempotent-Replayed: true`. Errors share one shape:
 * `{ "error": { "code", "message", "details" } }`.
 *
 * @param service - The use cases the routes call.
 * @param options - Server options; see {@link AppOptions}.
 */
export function buildApp(
  service: LedgerService,
  options: AppOptions = {},
): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });

  app.post(
    '/accounts/:id/credits',
    async (
      request,
      res,
    ) => {
      const key = idempotencyKey(request);
      const { id } = accountParams.parse(request.params);
      const body = creditBody.parse(request.body);

      const execution = await service.credit({
        accountId: id,
        amount: body.amount,
        idempotencyKey: key,
      });

      return reply(
        res,
        execution,
        HTTP_CREATED,
      );
    },
  );

  app.get(
    '/accounts/:id',
    async (request) => {
      const { id } = accountParams.parse(request.params);

      return service.getAccount(id);
    },
  );

  app.post(
    '/reservations',
    async (
      request,
      res,
    ) => {
      const key = idempotencyKey(request);
      const body = reserveBody.parse(request.body);

      const execution = await service.reserve({
        ...body,
        idempotencyKey: key,
      });

      return reply(
        res,
        execution,
        HTTP_CREATED,
      );
    },
  );

  app.post(
    '/reservations/:id/capture',
    async (
      request,
      res,
    ) => {
      const key = idempotencyKey(request);
      const { id } = reservationParams.parse(request.params);
      const body = captureBody.parse(request.body);

      const execution = await service.capture({
        reservationId: id,
        amount: body.amount,
        idempotencyKey: key,
      });

      return reply(
        res,
        execution,
        HTTP_OK,
      );
    },
  );

  app.post(
    '/reservations/:id/release',
    async (
      request,
      res,
    ) => {
      const key = idempotencyKey(request);
      const { id } = reservationParams.parse(request.params);

      releaseBody.parse(request.body ?? undefined);

      const execution = await service.release({
        reservationId: id,
        idempotencyKey: key,
      });

      return reply(
        res,
        execution,
        HTTP_OK,
      );
    },
  );

  app.setErrorHandler(handleError);

  return app;
}
