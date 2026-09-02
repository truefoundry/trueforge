import { z } from '@hono/zod-openapi';

export const SessionRepositorySchema = z
  .object({
    url: z.url().refine(value => {
      const parsed = new URL(value);
      return parsed.protocol === 'https:' && parsed.username === '' && parsed.password === '';
    }, 'Repository URL must use HTTPS and must not contain credentials.'),
    ref: z
      .string()
      .min(1)
      .max(255)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/, 'Ref contains unsupported characters.')
      .refine(value => !value.includes('..') && !value.includes('@{') && !value.endsWith('.lock'), 'Invalid Git ref.')
      .describe('Branch, tag, or commit to check out.'),
    path: z
      .string()
      .min(1)
      .max(255)
      .regex(
        /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\/\/)[A-Za-z0-9._/-]+$/,
        'Path must be relative, portable, and may not traverse.',
      )
      .refine(value => value !== '.', 'Path must use a dedicated sandbox subdirectory.'),
    access: z.enum(['read_only', 'read_write']),
    credential_provider_ref: z.string().min(1).max(255).nullable().default(null),
  })
  .strict()
  .describe('A persistent Git checkout provisioned in the session sandbox.')
  .openapi('SessionRepository');

export type SessionRepository = z.infer<typeof SessionRepositorySchema>;
