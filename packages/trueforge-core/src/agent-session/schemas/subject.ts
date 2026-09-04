import { z } from '@hono/zod-openapi';

/** Persisted creator identity on agent, session, schedule, and schedule_run rows. */
export const CreatedBySubjectSchema = z
  .object({
    subject_id: z.string().min(1).describe('Subject id.'),
    subject_type: z.string().min(1).describe('Subject type.'),
    subject_display_name: z.string().min(1).describe('Display name.'),
  })
  .strict()
  .describe('Who created this resource.')
  .openapi('CreatedBySubject');

export type CreatedBySubject = z.infer<typeof CreatedBySubjectSchema>;
