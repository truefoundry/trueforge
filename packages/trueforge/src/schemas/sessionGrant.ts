/** Session grant wire schemas. */
import { z } from '@hono/zod-openapi';
import { CreatedBySubjectSchema } from '@truefoundry/trueforge-core/agent-session';

const SESSION_GRANT_MAX_SUBJECTS_PER_LIST = 50;

export const SessionGrantSubjectTypeSchema = z
  .enum(['user', 'tenant'])
  .describe('Kind of subject. A `tenant` subject shares the session with everyone in the tenant.')
  .openapi('SessionGrantSubjectType');

export const SessionGrantSubjectSchema = z
  .object({
    subject_type: SessionGrantSubjectTypeSchema,
    subject_id: z.string().min(1).max(255).describe('ID of the subject.'),
  })
  .strict()
  .describe('Who the session is shared with.')
  .openapi('SessionGrantSubject');

export const SessionGrantSchema = z
  .object({
    subject: SessionGrantSubjectSchema,
    granted_by_subject: CreatedBySubjectSchema,
    created_at: z.string().describe('When the session was shared with the subject (ISO-8601 UTC).'),
  })
  .strict()
  .openapi('SessionGrant');

export const ListSessionGrantsResponseSchema = z
  .object({ data: z.array(SessionGrantSchema) })
  .openapi('ListSessionGrantsResponse');

export const UpdateSessionGrantsRequestSchema = z
  .object({
    grant: z
      .array(SessionGrantSubjectSchema)
      .max(SESSION_GRANT_MAX_SUBJECTS_PER_LIST)
      .optional()
      .default([])
      .describe(`Subjects to share the session with (up to ${String(SESSION_GRANT_MAX_SUBJECTS_PER_LIST)}).`),
    revoke: z
      .array(SessionGrantSubjectSchema)
      .max(SESSION_GRANT_MAX_SUBJECTS_PER_LIST)
      .optional()
      .default([])
      .describe(`Subjects to remove access for (up to ${String(SESSION_GRANT_MAX_SUBJECTS_PER_LIST)}).`),
  })
  .strict()
  .refine(body => body.grant.length + body.revoke.length > 0, {
    message: 'At least one subject to grant or revoke is required.',
  })
  .openapi('UpdateSessionGrantsRequest');

export type SessionGrantSubjectType = z.infer<typeof SessionGrantSubjectTypeSchema>;
export type SessionGrantSubject = z.infer<typeof SessionGrantSubjectSchema>;
export type SessionGrant = z.infer<typeof SessionGrantSchema>;
