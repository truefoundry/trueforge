import { OpenAPIHono } from '@hono/zod-openapi';
import { encodeOffsetPageToken } from '@truefoundry/trueforge-core/agent-session/store/OffsetPageToken';
import { createLogger } from 'winston';
import { createUsersRouter } from '../../../src/apis/users';
import { createAppErrorHandler } from '../../../src/app';
import { STANDALONE_REQUEST_CONTEXT } from '../../../src/auth/identity';
import { EmptyUserStore, type IUserStore, type ListUsersInput } from '../../../src/db/userStore';
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

function pagedUserStore(): { userStore: IUserStore; listUsers: jest.Mock } {
  const listUsers = jest.fn((input: ListUsersInput) =>
    Promise.resolve({ data: USERS.slice(input.offset, input.offset + input.limit), total: USERS.length }),
  );
  return { userStore: { listUsers, getUsersByIds: () => Promise.resolve([]) }, listUsers };
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

  it('defaults the page size', async () => {
    const { userStore, listUsers } = pagedUserStore();

    await buildApp(userStore).request('/');

    expect(listUsers).toHaveBeenCalledWith(expect.objectContaining({ query: undefined, limit: 25, offset: 0 }));
  });

  it('rejects an invalid page token', async () => {
    const { userStore, listUsers } = pagedUserStore();

    const response = await buildApp(userStore).request('/?page_token=not-a-token');

    expect(response.status).toBe(400);
    expect(listUsers).not.toHaveBeenCalled();
  });

  it('returns an empty list without a configured user store', async () => {
    const response = await buildApp(new EmptyUserStore()).request('/');

    expect(response.status).toBe(200);
    expect(ListUsersResponseSchema.parse(await response.json())).toEqual({ data: [], pagination: { limit: 25 } });
  });
});
