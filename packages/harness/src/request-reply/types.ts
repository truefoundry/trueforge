import { z } from 'zod';

/**
 * Plain JSON value, defined locally so the wire schema does not depend on any
 * web framework's types. Wire bodies are untyped JSON: the transport carries
 * them verbatim and each route handler validates its own body.
 */
export type JSONValue = string | number | boolean | null | JSONValue[] | { [key: string]: JSONValue };

// copied from zod 4
// https://zod.dev/api?id=json
// (recursive schemas cannot use z.infer — zod v3 requires the explicit type
// annotation on z.lazy, so JSONValue is the one hand-written exception)
const jsonSchema: z.ZodType<JSONValue> = z.lazy(() => {
  return z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonSchema),
    z.record(z.string(), jsonSchema),
  ]);
});

/** Request payload as seen by the caller of redisRequest and by route handlers. */
export interface RequestEnvelope<T extends JSONValue = JSONValue> {
  body: T;
  headers?: Record<string, string> | undefined;
}

/** Body of a PUBLISH on the executor request channel (JSON string). */
export const publishedRequestSchema = z.object({
  replyKey: z.string(),
  path: z.string(),
  body: jsonSchema,
  headers: z.record(z.string(), z.string()).optional(),
});
export type PublishedRequest = z.infer<typeof publishedRequestSchema>;

export const jsonReplySchema = z.object({
  status: z.number().int().min(200).max(599),
  headers: z.record(z.string(), z.string()).optional(),
  body: jsonSchema,
});
export type JSONReply = z.infer<typeof jsonReplySchema>;

export type RequestHandler<T extends JSONValue = JSONValue> = (
  path: string,
  request: RequestEnvelope<T>,
) => Promise<JSONReply>;
