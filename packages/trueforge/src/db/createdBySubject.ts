import { CreatedBySubjectSchema, type CreatedBySubject } from '@truefoundry/trueforge-core/agent-session';

/** Re-parse persisted creator JSON so store readers validate on read. */
export function parseStoredCreatedBySubject(value: unknown): CreatedBySubject {
  return CreatedBySubjectSchema.parse(value);
}
