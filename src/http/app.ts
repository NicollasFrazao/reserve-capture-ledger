import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Execution } from '../application/idempotency.js';
import type { LedgerService } from '../application/ledger-service.js';
import { LedgerError } from '../domain/errors.js';

/** Business error code → HTTP status. Anything unlisted is a 500. */
const STATUS_BY_CODE: Readonly<Record<string, number>> = {
  invalid_amount: 400,
  invalid_ttl: 400,
  account_not_found: 404,
  reservation_not_found: 404,
  idempotency_key_conflict: 409,
  invalid_transition: 409,
  reservation_expired: 409,
  insufficient_funds: 422,
  capture_exceeds_reservation: 422,
};

const accountId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'letters, digits, "_" or "-", up to 64');
const amount = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

const accountParams = z.object({ id: accountId });
const reservationParams = z.object({ id: z.uuid() });
const creditBody = z.object({ amount }).strict();
const reserveBody = z.object({ accountId, amount, ttlSeconds: z.number().int().positive().optional() }).strict();
const captureBody = z.object({ amount }).strict();
const releaseBody = z.object({}).strict().optional();
const idempotencyHeaders = z.object({
  'idempotency-key': z
    .string({ error: 'the Idempotency-Key header is required' })
    .regex(/^[\x21-\x7E]{1,255}$/, 'Idempotency-Key must be 1 to 255 visible ASCII characters'),
});

class BadRequest extends LedgerError {
  readonly code = 'bad_request';
}

function idempotencyKey(request: FastifyRequest): string {
  return idempotencyHeaders.parse(request.headers)['idempotency-key'];
}

function statusOf(code: string): number {
  return STATUS_BY_CODE[code] ?? 500;
}

/** Writes an execution: the same outcome always produces the same response. */
function reply<T>(res: FastifyReply, execution: Execution<T>, successStatus: number): FastifyReply {
  if (execution.replayed) void res.header('Idempotent-Replayed', 'true');
  const { outcome } = execution;
  return outcome.ok
    ? res.code(successStatus).send(outcome.value)
    : res.code(statusOf(outcome.error.code)).send({ error: outcome.error });
}

export function buildApp(service: LedgerService, options: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });

  app.post('/accounts/:id/credits', async (request, res) => {
    const key = idempotencyKey(request);
    const { id } = accountParams.parse(request.params);
    const body = creditBody.parse(request.body);
    return reply(res, await service.credit({ accountId: id, amount: body.amount, idempotencyKey: key }), 201);
  });

  app.get('/accounts/:id', async (request) => {
    const { id } = accountParams.parse(request.params);
    return service.getAccount(id);
  });

  app.post('/reservations', async (request, res) => {
    const key = idempotencyKey(request);
    const body = reserveBody.parse(request.body);
    return reply(res, await service.reserve({ ...body, idempotencyKey: key }), 201);
  });

  app.post('/reservations/:id/capture', async (request, res) => {
    const key = idempotencyKey(request);
    const { id } = reservationParams.parse(request.params);
    const body = captureBody.parse(request.body);
    return reply(res, await service.capture({ reservationId: id, amount: body.amount, idempotencyKey: key }), 200);
  });

  app.post('/reservations/:id/release', async (request, res) => {
    const key = idempotencyKey(request);
    const { id } = reservationParams.parse(request.params);
    releaseBody.parse(request.body ?? undefined);
    return reply(res, await service.release({ reservationId: id, idempotencyKey: key }), 200);
  });

  app.setErrorHandler((error, request, res) => {
    if (error instanceof z.ZodError) {
      const message = error.issues.map((issue) => `${issue.path.join('.') || 'request'}: ${issue.message}`).join('; ');
      return res.code(400).send({ error: new BadRequest(message).toJSON() });
    }
    if (error instanceof LedgerError) {
      return res.code(statusOf(error.code)).send({ error: error.toJSON() });
    }
    // Fastify's own client errors: malformed JSON, wrong content type, body too large.
    const statusCode = (error as { statusCode?: unknown }).statusCode;
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
      return res.code(statusCode).send({ error: new BadRequest((error as Error).message).toJSON() });
    }
    request.log.error(error);
    return res.code(500).send({ error: { code: 'internal_error', message: 'internal error', details: {} } });
  });

  return app;
}
