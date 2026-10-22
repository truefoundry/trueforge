/** Session access wire schemas. */
import { z } from '@hono/zod-openapi';
import { CreatedBySubjectSchema } from '@truefoundry/trueforge-core/agent-session';

const SESSION_ACCESS_MAX_SUBJECTS_PER_REQUEST = 50;

export const SessionAccessSubjectTypeSchema = z
  .enum(['user'])
  .describe('Kind of subject.')
  .openapi('SessionAccessSubjectType');

export const SessionAccessSubjectSchema = z
  .object({
    subject_type: SessionAccessSubjectTypeSchema,
    subject_id: z.string().min(1).max(255).describe('ID of the subject.'),
  })
  .strict()
  .describe('Who the session is shared with.')
  .openapi('SessionAccessSubject');

export const SessionAccessSchema = z
  .object({
    subject: SessionAccessSubjectSchema,
    granted_by_subject: CreatedBySubjectSchema,
    created_at: z.string().describe('When the session was shared with the subject (ISO-8601 UTC).'),
  })
  .strict()
  .openapi('SessionAccess');

export const ListSessionAccessResponseSchema = z
  .object({ data: z.array(SessionAccessSchema) })
  .openapi('ListSessionAccessResponse');

export const CreateSessionAccessRequestSchema = z
  .object({
    subjects: z
      .array(SessionAccessSubjectSchema)
      .min(1)
      .max(SESSION_ACCESS_MAX_SUBJECTS_PER_REQUEST)
      .describe(`Subjects to share the session with (1–${String(SESSION_ACCESS_MAX_SUBJECTS_PER_REQUEST)}).`),
  })
  .strict()
  .openapi('CreateSessionAccessRequest');

export const DeleteSessionAccessResponseSchema = z.object({}).strict().openapi('DeleteSessionAccessResponse');

export type SessionAccessSubjectType = z.infer<typeof SessionAccessSubjectTypeSchema>;
export type SessionAccessSubject = z.infer<typeof SessionAccessSubjectSchema>;
export type SessionAccess = z.infer<typeof SessionAccessSchema>;
