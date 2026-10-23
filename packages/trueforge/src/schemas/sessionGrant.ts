/** Session grant wire schemas. */
import { z } from '@hono/zod-openapi';
import { CreatedBySubjectSchema } from '@truefoundry/trueforge-core/agent-session';

const SESSION_ACCESS_MAX_SUBJECTS_PER_REQUEST = 50;

export const SessionGrantSubjectTypeSchema = z
  .enum(['user'])
  .describe('Kind of subject.')
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

export const CreateSessionGrantsRequestSchema = z
  .object({
    subjects: z
      .array(SessionGrantSubjectSchema)
      .min(1)
      .max(SESSION_ACCESS_MAX_SUBJECTS_PER_REQUEST)
      .describe(`Subjects to share the session with (1–${String(SESSION_ACCESS_MAX_SUBJECTS_PER_REQUEST)}).`),
  })
  .strict()
  .openapi('CreateSessionGrantsRequest');

export const DeleteSessionGrantsRequestQuerySchema = z
  .object({
    subject_type: SessionGrantSubjectTypeSchema,
    subject_id: SessionGrantSubjectSchema.shape.subject_id,
  })
  .openapi('DeleteSessionGrantsRequestQuery');

export const DeleteSessionGrantResponseSchema = z.object({}).strict().openapi('DeleteSessionGrantResponse');

export type SessionGrantSubjectType = z.infer<typeof SessionGrantSubjectTypeSchema>;
export type SessionGrantSubject = z.infer<typeof SessionGrantSubjectSchema>;
export type SessionGrant = z.infer<typeof SessionGrantSchema>;
