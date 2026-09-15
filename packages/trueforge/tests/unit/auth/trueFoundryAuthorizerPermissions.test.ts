import type { RequestContext } from '../../../src/auth/identity';
import { TrueFoundryAuthorizer } from '../../../src/truefoundry/TrueFoundryAuthorizer';
import type { TrueFoundryServiceFoundryServerClient } from '../../../src/truefoundry/TrueFoundryServiceFoundryServerClient';

const ALICE: RequestContext = {
  tenant_id: 'default',
  subject: { id: 'alice', type: 'user', display_name: 'alice' },
  roles: [],
  user_credential: 'user-jwt',
};

describe('TrueFoundryAuthorizer.getPermissions tenant', () => {
  it('maps CREATE_AGENT to tenant agent CREATE', async () => {
    const client = {
      getTenantPermissions: jest.fn(async () => ['CREATE_AGENT', 'CREATE_WORKSPACE']),
    } as unknown as TrueFoundryServiceFoundryServerClient;
    const authorizer = new TrueFoundryAuthorizer(client);

    await expect(
      authorizer.getPermissions({
        resourceType: 'tenant',
        requestContext: ALICE,
        resourceIds: [],
      }),
    ).resolves.toEqual({
      type: 'tenant',
      permissions: { agent: ['CREATE'] },
    });
    expect(client.getTenantPermissions).toHaveBeenCalledWith({ accessToken: 'user-jwt' });
  });

  it('returns empty agent grants when CREATE_AGENT is absent', async () => {
    const client = {
      getTenantPermissions: jest.fn(async () => ['CREATE_WORKSPACE']),
    } as unknown as TrueFoundryServiceFoundryServerClient;
    const authorizer = new TrueFoundryAuthorizer(client);

    await expect(
      authorizer.getPermissions({
        resourceType: 'tenant',
        requestContext: ALICE,
        resourceIds: [],
      }),
    ).resolves.toEqual({
      type: 'tenant',
      permissions: { agent: [] },
    });
  });
});
