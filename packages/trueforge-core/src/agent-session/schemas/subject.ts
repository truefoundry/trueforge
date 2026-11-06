import { z } from '@hono/zod-openapi';

/** Identity of a subject acting on a resource. */
export const SubjectSchema = z
  .object({
    subject_id: z.string().min(1).describe('Subject id.'),
    subject_type: z.string().min(1).describe('Subject type.'),
    subject_display_name: z.string().min(1).describe('Display name.'),
  })
  .strict()
  .describe('Identity of a subject.')
  .openapi('Subject');

export type Subject = z.infer<typeof SubjectSchema>;
