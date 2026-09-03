/** Auth wire schemas. */
import { z } from '@hono/zod-openapi';

export const AuthLoginQuerySchema = z.object({
  return_to: z
    .string()
    .optional()
    .describe('Path to return to after login. Must be a same-origin relative path; anything else falls back to "/".'),
});

export const OAuthCallbackQuerySchema = z.object({
  code: z.string().min(1).optional().describe('Authorization code, present when the user granted consent.'),
  state: z
    .string()
    .min(1)
    .describe('Opaque token; correlates this callback to its pending login. Always present, success or error.'),
  error: z
    .string()
    .optional()
    .describe('Error code from the identity provider, present instead of `code` if the user denied consent.'),
  error_description: z
    .string()
    .optional()
    .describe('Human-readable error detail from the identity provider when `error` is set.'),
});

export const OAuthCallbackSuccessSchema = z.object({
  success: z.literal(true).describe('Present when the OAuth callback completed without a return_to.'),
});

/** Wire copy of identity `SubjectType` — kept local so OpenAPI uses `@hono/zod-openapi`. */
const GetMeSubjectTypeSchema = z
  .enum(['user', 'virtualaccount'])
  .describe('Subject kind: interactive user or virtual account.');

export const GetMeSubjectSchema = z
  .object({
    id: z.string().describe('Stable subject identifier for the caller.'),
    type: GetMeSubjectTypeSchema,
    display_name: z.string().describe('Human-readable name for the caller.'),
  })
  .openapi('GetMeSubject');

export const GetMeResponseSchema = z
  .object({
    tenant_id: z.string().describe('Tenant scope for the authenticated caller.'),
    subject: GetMeSubjectSchema,
    is_admin: z.boolean().describe('Whether the caller has admin privileges.'),
  })
  .openapi('GetMeResponse');

export type GetMeSubject = z.infer<typeof GetMeSubjectSchema>;
export type GetMeResponse = z.infer<typeof GetMeResponseSchema>;
