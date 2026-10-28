import type { RequestContext } from '../../../src/auth/identity';
import type { TrueFoundryServiceFoundryServerClient } from '../../../src/truefoundry/TrueFoundryServiceFoundryServerClient';
import { TrueFoundryUserStore } from '../../../src/truefoundry/TrueFoundryUserStore';

const context: RequestContext = {
  tenant_id: 'acme',
  subject: { id: 'caller', type: 'user', display_name: 'Caller' },
  roles: [],
  user_credential: 'caller-token',
};

function userStoreWith(peekUsers: jest.Mock) {
  const client: Pick<TrueFoundryServiceFoundryServerClient, 'peekUsers'> = { peekUsers };
  return new TrueFoundryUserStore(client);
}

describe('TrueFoundryUserStore', () => {
  it('searches by name with limit and offset and maps users, falling back to email for the display name', async () => {
    const peekUsers = jest.fn().mockResolvedValue({
      users: [
        { id: 'u1', name: 'Alice', email: 'alice@example.com' },
        { id: 'u2', name: null, email: 'bob@example.com' },
      ],
      totalUsers: 7,
    });

    const result = await userStoreWith(peekUsers).listUsers({ context, query: 'a', limit: 3, offset: 3 });

    expect(peekUsers).toHaveBeenCalledWith({ accessToken: 'caller-token', name: 'a', limit: 3, offset: 3 });
    expect(result).toEqual({
      data: [
        { id: 'u1', display_name: 'Alice', email: 'alice@example.com' },
        { id: 'u2', display_name: 'bob@example.com', email: 'bob@example.com' },
      ],
      total: 7,
    });
  });

  it('omits the name filter when there is no query', async () => {
    const peekUsers = jest.fn().mockResolvedValue({ users: [], totalUsers: 0 });

    await userStoreWith(peekUsers).listUsers({ context, query: undefined, limit: 25, offset: 0 });

    expect(peekUsers).toHaveBeenCalledWith({ accessToken: 'caller-token', limit: 25, offset: 0 });
  });

  it('looks up de-duplicated ids without paging', async () => {
    const peekUsers = jest
      .fn()
      .mockResolvedValue({ users: [{ id: 'u1', name: 'Alice', email: 'alice@example.com' }], totalUsers: 1 });

    const users = await userStoreWith(peekUsers).getUsersByIds({ context, ids: ['u1', 'u2', 'u1'] });

    expect(peekUsers).toHaveBeenCalledWith({ accessToken: 'caller-token', ids: ['u1', 'u2'] });
    expect(users).toEqual([{ id: 'u1', display_name: 'Alice', email: 'alice@example.com' }]);
  });

  it('chunks large id lookups', async () => {
    const peekUsers = jest.fn().mockResolvedValue({ users: [], totalUsers: 0 });
    const ids = Array.from({ length: 120 }, (_, i) => `u${String(i)}`);

    await userStoreWith(peekUsers).getUsersByIds({ context, ids });

    expect(peekUsers.mock.calls.map(([input]: [{ ids: string[] }]) => input.ids.length)).toEqual([50, 50, 20]);
  });

  it('skips ServiceFoundry for an empty id list', async () => {
    const peekUsers = jest.fn();

    await expect(userStoreWith(peekUsers).getUsersByIds({ context, ids: [] })).resolves.toEqual([]);
    expect(peekUsers).not.toHaveBeenCalled();
  });

  it('requires a caller token', async () => {
    const peekUsers = jest.fn();

    await expect(
      userStoreWith(peekUsers).listUsers({
        context: { ...context, user_credential: null },
        query: undefined,
        limit: 25,
        offset: 0,
      }),
    ).rejects.toMatchObject({ status: 401 });
  });
});
