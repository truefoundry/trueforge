import { z } from '@hono/zod-openapi';

export const SubjectTypeSchema = z.enum(['user', 'virtualaccount']).openapi('SubjectType');
export type SubjectType = z.infer<typeof SubjectTypeSchema>;

/** Persisted creator identity on agent, session, schedule, and schedule_run rows. */
export const CreatedBySubjectSchema = z
  .object({
    subject_id: z.string().min(1).describe('Subject id.'),
    subject_type: z.string().min(1).describe('user or virtualaccount.'),
    subject_display_name: z.string().min(1).describe('Display name.'),
  })
  .strict()
  .describe('Who created this resource.')
  .openapi('CreatedBySubject');

export type CreatedBySubject = z.infer<typeof CreatedBySubjectSchema>;

/** Re-parse persisted creator JSON so store readers validate on read. */
export function parseStoredCreatedBySubject(value: unknown): CreatedBySubject {
  return CreatedBySubjectSchema.parse(value);
}
