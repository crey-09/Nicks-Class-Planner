import type { FastifyReply } from 'fastify';
import { z } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function idParam(params: unknown): number {
  const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(params);
  return id;
}

export function parseBody<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const r = schema.safeParse(body);
  if (!r.success) throw new HttpError(400, r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  return r.data;
}

export function notFound(reply: FastifyReply, what = 'Not found') {
  return reply.code(404).send({ error: what });
}

export const isoDate = z.string().datetime({ offset: true });
export const nullableIso = isoDate.nullable();

export function nowIso() { return new Date().toISOString(); }

/** Date-range query used by shifts, events, blocks and calendar. */
export const rangeQuery = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
});
