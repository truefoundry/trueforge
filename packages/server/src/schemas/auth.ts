/** Auth wire schemas. */
import { z } from '@hono/zod-openapi';

export const AuthRoleSchema = z.enum(['admin', 'user']).openapi('AuthRole');

export const AuthMeResponseSchema = z
  .object({
    user_ref: z.string(),
    role: AuthRoleSchema,
  })
  .openapi('AuthMeResponse');

export type AuthMeResponse = z.infer<typeof AuthMeResponseSchema>;

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
  error_description: z.string().optional(),
});

export const OAuthCallbackSuccessSchema = z.object({
  success: z.literal(true),
});
