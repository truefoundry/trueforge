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

export const GetMeResponseSchema = z
  .object({
    type: z
      .enum(['default', 'oidc-connected'])
      .describe(
        'Session kind: `default` when no valid OIDC session; `oidc-connected` after a successful browser login.',
      ),
    email: z.string().describe('User email from the ID token when connected; `"default"` when anonymous.'),
    role: z.string().describe('Caller role.'),
  })
  .openapi('GetMeResponse');

export type GetMeResponse = z.infer<typeof GetMeResponseSchema>;
