import type { GetUsersByIdsInput, IUserStore, ListUsersInput } from '../db/userStore';
import type { User } from '../schemas/user';
import { callerAccessToken } from './accessToken';
import type { PeekUser, TrueFoundryServiceFoundryServerClient } from './TrueFoundryServiceFoundryServerClient';

/** Ids travel in the `filter` query param; chunk so the URL stays well under server header limits. */
const PEEK_IDS_CHUNK_SIZE = 50;

function toUser(user: PeekUser): User {
  return {
    id: user.id,
    display_name: user.name ?? user.email,
    email: user.email,
  };
}

/** Tenant users from ServiceFoundry, looked up with the caller's token. */
export class TrueFoundryUserStore implements IUserStore {
  readonly supportsUserLookup = true;
  readonly #client: Pick<TrueFoundryServiceFoundryServerClient, 'peekUsers'>;

  constructor(client: Pick<TrueFoundryServiceFoundryServerClient, 'peekUsers'>) {
    this.#client = client;
  }

  async listUsers(input: ListUsersInput): Promise<{ data: User[]; total: number }> {
    const { users, totalUsers } = await this.#client.peekUsers({
      accessToken: await callerAccessToken(input.context)(),
      ...(input.query === undefined ? {} : { name: input.query }),
      limit: input.limit,
      offset: input.offset,
    });
    return { data: users.map(toUser), total: totalUsers };
  }

  async getUsersByIds(input: GetUsersByIdsInput): Promise<User[]> {
    const ids = [...new Set(input.ids)];
    if (ids.length === 0) {
      return [];
    }
    const accessToken = await callerAccessToken(input.context)();
    const found: User[] = [];
    for (let i = 0; i < ids.length; i += PEEK_IDS_CHUNK_SIZE) {
      const chunk = ids.slice(i, i + PEEK_IDS_CHUNK_SIZE);
      const { users } = await this.#client.peekUsers({ accessToken, ids: chunk });
      found.push(...users.map(toUser));
    }
    return found;
  }
}
