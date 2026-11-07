/** Access grants on sessions. Rows are removed with their session. */
import type { CreatedBySubject } from '@truefoundry/trueforge-core/agent-session';
import type { SessionGrantSubject, SessionGrantSubjectType } from '../schemas/sessionGrant';

export interface AccessGrantRecord {
  tenant_id: string;
  session_id: string;
  subject_type: SessionGrantSubjectType;
  subject_id: string;
  granted_by_subject: CreatedBySubject;
  /** ISO-8601 UTC instant. */
  created_at: string;
}

export interface CreateAccessGrantsInput {
  tenant_id: string;
  session_id: string;
  /** Non-empty and de-duplicated by the caller. */
  subjects: SessionGrantSubject[];
  granted_by_subject: CreatedBySubject;
}

export interface ListAccessGrantsInput {
  tenant_id: string;
  session_ids: readonly string[];
  /** When set, only grants for these subjects. */
  subjects?: readonly SessionGrantSubject[];
}

export interface DeleteAccessGrantsInput {
  tenant_id: string;
  session_id: string;
  /** Non-empty and de-duplicated by the caller. */
  subjects: SessionGrantSubject[];
}

export interface IAccessControlStore<TTransaction = never> {
  /**
   * Inserts the grants in one statement, so either all land or none do; existing grants are left
   * untouched. Rejects when the session does not exist.
   */
  createAccessGrants(input: CreateAccessGrantsInput, transaction?: TTransaction): Promise<void>;
  /** Ordered by (session_id, created_at, subject_id). */
  listAccessGrants(input: ListAccessGrantsInput, transaction?: TTransaction): Promise<AccessGrantRecord[]>;
  /** Deletes the subjects' grants in one statement; subjects without a grant are ignored. */
  deleteAccessGrants(input: DeleteAccessGrantsInput, transaction?: TTransaction): Promise<void>;
}
