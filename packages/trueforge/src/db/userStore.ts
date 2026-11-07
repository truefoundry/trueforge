import type { RequestContext } from '../auth/identity';
import type { User } from '../schemas/user';

export interface ListUsersInput {
  context: RequestContext;
  /** Case-insensitive substring on email or display name. */
  query: string | undefined;
  limit: number;
  offset: number;
}

export interface GetUsersByIdsInput {
  context: RequestContext;
  ids: readonly string[];
}

/** Tenant users that sessions can be shared with. */
export interface IUserStore {
  /** False when there is no user source, so sessions can only be shared with the whole tenant. */
  readonly supportsUserLookup: boolean;
  /** Searches first, then paginates; `total` counts all matches. */
  listUsers(input: ListUsersInput): Promise<{ data: User[]; total: number }>;
  /** Active users among `ids`; unknown or inactive ids are absent. */
  getUsersByIds(input: GetUsersByIdsInput): Promise<User[]>;
}

/** Standalone and OIDC have no user source, so sharing with users is unavailable. */
export class EmptyUserStore implements IUserStore {
  readonly supportsUserLookup = false;

  listUsers(): Promise<{ data: User[]; total: number }> {
    return Promise.resolve({ data: [], total: 0 });
  }

  getUsersByIds(): Promise<User[]> {
    return Promise.resolve([]);
  }
}
