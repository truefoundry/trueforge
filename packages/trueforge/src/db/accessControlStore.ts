/** Explicit per-subject access to a session. Rows are removed with their session. */
import type { CreatedBySubject } from '@truefoundry/trueforge-core/agent-session';
import type { SessionGrantSubject, SessionGrantSubjectType } from '../schemas/sessionGrant';

export interface SessionAccessRecord {
  tenant_id: string;
  session_id: string;
  subject_type: SessionGrantSubjectType;
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
  subjects: SessionGrantSubject[];
  granted_by_subject: CreatedBySubject;
}

export interface RevokeSessionAccessInput {
  tenant_id: string;
  session_id: string;
  /** Non-empty and de-duplicated by the caller. */
  subjects: SessionGrantSubject[];
}

export interface HasSessionAccessInput {
  tenant_id: string;
  session_id: string;
  /** The calling user; undefined for non-user callers, which only match a `tenant` grant. */
  user_id: string | undefined;
}

export interface ListTenantSharedSessionIdsInput {
  tenant_id: string;
  session_ids: readonly string[];
}

export interface IAccessControlStore<TTransaction = never> {
  /** True when the user holds a `user` grant, or the session is shared with the whole tenant. */
  hasSessionAccess(input: HasSessionAccessInput, transaction?: TTransaction): Promise<boolean>;
  /** The ids among `session_ids` that hold a `tenant` grant for `tenant_id`. */
  listTenantSharedSessionIds(input: ListTenantSharedSessionIdsInput, transaction?: TTransaction): Promise<string[]>;
  /** Ordered by (created_at, subject_id). */
  listSessionAccess(input: ListSessionAccessInput, transaction?: TTransaction): Promise<SessionAccessRecord[]>;
  /**
   * Inserts the subjects in one statement, so either all land or none do; existing entries are left
   * untouched. Rejects when the session does not exist.
   */
  grantSessionAccess(input: GrantSessionAccessInput, transaction?: TTransaction): Promise<void>;
  /** Deletes the subjects' entries in one statement; subjects without an entry are ignored. */
  revokeSessionAccess(input: RevokeSessionAccessInput, transaction?: TTransaction): Promise<void>;
}
