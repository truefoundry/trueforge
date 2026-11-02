import { OpenAPIHono } from '@hono/zod-openapi';
import { encodeOffsetPageToken } from '@truefoundry/trueforge-core/agent-session/store/OffsetPageToken';
import { createLogger } from 'winston';
import { createUsersRouter } from '../../../src/apis/users';
import { createAppErrorHandler } from '../../../src/app';
import { STANDALONE_REQUEST_CONTEXT } from '../../../src/auth/identity';
import { type GetUsersByIdsInput, type IUserStore, type ListUsersInput } from '../../../src/db/userStore';
import { ListUsersResponseSchema, type User } from '../../../src/schemas/user';

const USERS: User[] = Array.from({ length: 5 }, (_, i) => ({
  id: `u${String(i)}`,
  display_name: `User ${String(i)}`,
  email: `user${String(i)}@example.com`,
}));

function buildApp(userStore: IUserStore): OpenAPIHono {
  const app = new OpenAPIHono();
  app.route('/', createUsersRouter({ userStore, resolveRequestContext: () => STANDALONE_REQUEST_CONTEXT }));
  app.onError(createAppErrorHandler({ logger: createLogger({ silent: true }) }));
  return app;
}

function pagedUserStore(): { userStore: IUserStore; listUsers: jest.Mock; getUsersByIds: jest.Mock } {
  const listUsers = jest.fn((input: ListUsersInput) =>
    Promise.resolve({ data: USERS.slice(input.offset, input.offset + input.limit), total: USERS.length }),
  );
  const getUsersByIds = jest.fn((input: GetUsersByIdsInput) =>
    Promise.resolve(USERS.filter(user => input.ids.includes(user.id))),
  );
  return { userStore: { supportsUserLookup: true, listUsers, getUsersByIds }, listUsers, getUsersByIds };
}

describe('users API', () => {
  it('passes the query, limit, and offset to the user store', async () => {
    const { userStore, listUsers } = pagedUserStore();

    const response = await buildApp(userStore).request(
      `/?query=${encodeURIComponent(' ali ')}&limit=2&page_token=${encodeOffsetPageToken(2)}`,
    );

    expect(response.status).toBe(200);
    expect(listUsers).toHaveBeenCalledWith({ context: STANDALONE_REQUEST_CONTEXT, query: 'ali', limit: 2, offset: 2 });
  });

  it('pages through every match and stops on the last page', async () => {
    const { userStore } = pagedUserStore();
    const app = buildApp(userStore);

    const first = ListUsersResponseSchema.parse(await (await app.request('/?limit=2')).json());
    expect(first.data.map(user => user.id)).toEqual(['u0', 'u1']);
    expect(first.pagination.next_page_token).toBeDefined();

    const second = ListUsersResponseSchema.parse(
      await (await app.request(`/?limit=2&page_token=${first.pagination.next_page_token ?? ''}`)).json(),
    );
    expect(second.data.map(user => user.id)).toEqual(['u2', 'u3']);

    const last = ListUsersResponseSchema.parse(
      await (await app.request(`/?limit=2&page_token=${second.pagination.next_page_token ?? ''}`)).json(),
    );
    expect(last.data.map(user => user.id)).toEqual(['u4']);
    expect(last.pagination.next_page_token).toBeUndefined();
  });

  it('rejects an invalid page token', async () => {
    const { userStore, listUsers } = pagedUserStore();

    const response = await buildApp(userStore).request('/?page_token=not-a-token');

    expect(response.status).toBe(400);
    expect(listUsers).not.toHaveBeenCalled();
  });

  describe('ids', () => {
    it('looks up the given users and omits unknown ones', async () => {
      const { userStore, listUsers, getUsersByIds } = pagedUserStore();

      const response = await buildApp(userStore).request('/?ids=u1, ,u3,ghost');

      expect(response.status).toBe(200);
      expect(getUsersByIds).toHaveBeenCalledWith({ context: STANDALONE_REQUEST_CONTEXT, ids: ['u1', 'u3', 'ghost'] });
      expect(listUsers).not.toHaveBeenCalled();
      const body = ListUsersResponseSchema.parse(await response.json());
      expect(body.data.map(user => user.id)).toEqual(['u1', 'u3']);
      expect(body.pagination).toEqual({ limit: 3 });
    });

    it.each([
      ['more than 100 ids', `ids=${Array.from({ length: 101 }, (_, i) => `u${String(i)}`).join(',')}`],
      ['an empty list', 'ids='],
      ['a query as well', 'ids=u1&query=ali'],
    ])('rejects %s', async (_label, search) => {
      const { userStore, listUsers, getUsersByIds } = pagedUserStore();

      const response = await buildApp(userStore).request(`/?${search}`);

      expect(response.status).toBe(400);
      expect(listUsers).not.toHaveBeenCalled();
      expect(getUsersByIds).not.toHaveBeenCalled();
    });
  });
});
