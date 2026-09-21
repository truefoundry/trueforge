import type { Context } from 'hono';
import { TrueFoundryAuthenticator } from '../../../src/truefoundry/TrueFoundryAuthenticator';

describe('TrueFoundryAuthenticator', () => {
  it('maps GET /v1/session into request context identity', async () => {
    const getSession = jest.fn().mockResolvedValue({
      user: {
        tenantName: 'internal',
        roles: ['tenant-admin'],
        subject: {
          subjectId: 'user-1',
          subjectType: 'user',
          subjectDisplayName: 'Alice',
          subjectSlug: 'alice@example.com',
        },
      },
    });
    const authenticator = new TrueFoundryAuthenticator({ getSession });
    const context = {
      req: {
        header: (name: string) => (name.toLowerCase() === 'authorization' ? 'Bearer tok' : undefined),
      },
    } as unknown as Context;

    const requestContext = await authenticator.authenticate(context);

    expect(getSession).toHaveBeenCalledWith('tok');
    expect(requestContext).toMatchObject({
      tenant_id: 'internal',
      subject: { id: 'user-1', type: 'user', display_name: 'Alice' },
      roles: ['tenant-admin'],
      user_credential: 'tok',
    });
  });
});
