import type { CreatedBySubject } from '../server/types.js';

/** Prefer display name; fall back to id when the host left the name empty. */
export function createdByLabel(subject: CreatedBySubject): string {
  return subject.subjectDisplayName || subject.subjectId;
}

export function hasCreatedBySubject(rows: readonly { createdBySubject?: CreatedBySubject | undefined }[]): boolean {
  return rows.some(row => row.createdBySubject != null);
}
