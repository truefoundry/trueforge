import type { Context } from 'hono';
import { TrueFoundryAuthenticator } from '../../../src/truefoundry/TrueFoundryAuthenticator';

describe('TrueFoundryAuthenticator', () => {
  it('stores public_base_url from GET /v1/session on request context', async () => {
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
      public_base_url: 'https://internal.truefoundry.cloud',
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
      public_base_url: 'https://internal.truefoundry.cloud',
    });
  });
});
