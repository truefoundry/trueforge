/** Explicit per-subject grants on a session. Rows are removed with their session. */
import type { CreatedBySubject } from '@truefoundry/trueforge-core/agent-session';
import type { SessionAccessSubject, SessionAccessSubjectType } from '../schemas/sessionAccess';

export interface SessionAccessRecord {
  tenant_id: string;
  session_id: string;
  subject_type: SessionAccessSubjectType;
  subject_id: string;
  granted_by_subject: CreatedBySubject;
  /** ISO-8601 UTC instant. */
  created_at: string;
}

export interface ListSessionAccessInput {
  tenant_id: string;
  session_id: string;
}

export interface GrantSessionAccessInput {
  tenant_id: string;
  session_id: string;
  /** Non-empty and de-duplicated by the caller. */
  subjects: SessionAccessSubject[];
  granted_by_subject: CreatedBySubject;
}

export interface RevokeSessionAccessInput {
  tenant_id: string;
  session_id: string;
  subject: SessionAccessSubject;
}

export interface HasSessionAccessInput {
  tenant_id: string;
  session_id: string;
  /** The user asking; a `tenant` grant for `tenant_id` also matches. */
  subject_id: string;
}

export interface ListTenantSharedSessionIdsInput {
  tenant_id: string;
  session_ids: readonly string[];
}

export interface IAccessControlEntryStore<TTransaction = never> {
  /** True when the user holds a `user` grant, or the session is shared with the whole tenant. */
  hasAccess(input: HasSessionAccessInput, transaction?: TTransaction): Promise<boolean>;
  /** The ids among `session_ids` that hold a `tenant` grant for `tenant_id`. */
  listTenantSharedSessionIds(input: ListTenantSharedSessionIdsInput, transaction?: TTransaction): Promise<string[]>;
  /** Ordered by (created_at, subject_id). */
  listSessionAccess(input: ListSessionAccessInput, transaction?: TTransaction): Promise<SessionAccessRecord[]>;
  /**
   * Inserts the subjects in one statement, so either all land or none do; existing grants are left
   * untouched. Rejects when the session does not exist.
   */
  grantSessionAccess(input: GrantSessionAccessInput, transaction?: TTransaction): Promise<void>;
  /** Deletes one grant; false when it did not exist. */
  revokeSessionAccess(input: RevokeSessionAccessInput, transaction?: TTransaction): Promise<boolean>;
}
