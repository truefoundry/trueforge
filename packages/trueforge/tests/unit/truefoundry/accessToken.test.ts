import { AgentSpecSchema } from '@truefoundry/trueforge-core/agent-session';
import { HTTPException } from 'hono/http-exception';
import type { RequestContext } from '../../../src/auth/identity';
import type { AgentRecord } from '../../../src/db/agentStore';
import {
  ACTOR_AUTHORIZATION_HEADER,
  accessTokenForRequest,
  asTrueFoundryRequestContext,
  callerAccessToken,
  createTrueFoundryRequestContext,
  gatewayHeaders,
  savedAgentAccess,
} from '../../../src/truefoundry/accessToken';

const CONTEXT: RequestContext = {
  tenant_id: 'acme',
  subject: { id: 'user-1', type: 'user', display_name: 'User' },
  roles: [],
  user_credential: 'caller-token',
};
const LOGGER = { info: jest.fn() };

const VENDED = { subjectToken: 'user-token', actorToken: 'agent-token' };

const AGENT: AgentRecord = {
  id: 'agent-1',
  tenant_id: 'acme',
  name: 'named',
  description: 'Test agent.',
  manifest: AgentSpecSchema.parse({ model: { name: 'p/m' } }),
  external_id: 'ext-agent',
  created_by_subject: { subject_id: 'user-1', subject_type: 'user', subject_display_name: 'User' },
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

describe('callerAccessToken', () => {
  it('resolves the caller bearer', async () => {
    await expect(callerAccessToken(CONTEXT)()).resolves.toBe('caller-token');
  });

  it('rejects with 401 before any call is attempted when the caller has no token', () => {
    expect(() => callerAccessToken({ ...CONTEXT, user_credential: null })).toThrow(
      expect.objectContaining({ status: 401 }),
    );
  });
});

describe('gatewayHeaders', () => {
  it('sends the actor header only when the credential has one', () => {
    expect(gatewayHeaders({ type: 'caller', subjectToken: 'caller-token' })).toEqual({
      Authorization: 'Bearer caller-token',
    });
    expect(gatewayHeaders({ type: 'delegated', subjectToken: 'caller-token', actorAgentToken: 'agent-token' })).toEqual(
      {
        Authorization: 'Bearer caller-token',
        [ACTOR_AUTHORIZATION_HEADER]: 'Bearer agent-token',
      },
    );
  });
});

describe('savedAgentAccess', () => {
  it('delegates when the caller credential is present', async () => {
    const client = { vendToken: jest.fn().mockResolvedValue(VENDED) };
    const logger = { info: jest.fn() };

    const access = savedAgentAccess({ client, requestContext: CONTEXT, agent: AGENT, logger });
    await expect(access.resolveServiceFoundryAuthorization()).resolves.toBe('agent-token');
    await expect(access.resolveGatewayAuthorization()).resolves.toEqual({
      type: 'delegated',
      subjectToken: 'caller-token',
      actorToken: 'agent-token',
    });
    expect(logger.info).toHaveBeenCalledWith('Exchanging user context for agent access token', {
      subject: 'user-1',
      agentId: 'ext-agent',
    });
    expect(client.vendToken).toHaveBeenCalledWith({
      subject: CONTEXT.subject,
      agentId: 'ext-agent',
      tenantName: 'acme',
    });
    expect(client.vendToken).toHaveBeenCalledTimes(1);
  });

  it('exchanges when the caller credential is absent', async () => {
    const client = { vendToken: jest.fn().mockResolvedValue(VENDED) };
    const access = savedAgentAccess({
      client,
      requestContext: { ...CONTEXT, user_credential: null },
      agent: AGENT,
      logger: LOGGER,
    });

    await expect(access.resolveGatewayAuthorization()).resolves.toEqual({
      type: 'exchanged',
      subjectToken: 'user-token',
    });
    await expect(access.resolveServiceFoundryAuthorization()).resolves.toBe('agent-token');
    expect(client.vendToken).toHaveBeenCalledTimes(1);
  });

  it('vends again after a failed exchange', async () => {
    const client = {
      vendToken: jest.fn().mockRejectedValueOnce(new Error('vend failed')).mockResolvedValue(VENDED),
    };
    const access = savedAgentAccess({ client, requestContext: CONTEXT, agent: AGENT, logger: LOGGER });

    await expect(access.resolveServiceFoundryAuthorization()).rejects.toThrow('vend failed');
    await expect(access.resolveGatewayAuthorization()).resolves.toEqual({
      type: 'delegated',
      subjectToken: 'caller-token',
      actorToken: 'agent-token',
    });
    expect(client.vendToken).toHaveBeenCalledTimes(2);
  });

  it('rejects with 422 when the agent was never registered with TrueFoundry', () => {
    const client = { vendToken: jest.fn() };

    expect(() =>
      savedAgentAccess({
        client,
        requestContext: CONTEXT,
        agent: { ...AGENT, external_id: null },
        logger: LOGGER,
      }),
    ).toThrow(HTTPException);
    expect(client.vendToken).not.toHaveBeenCalled();
  });
});

describe('asTrueFoundryRequestContext', () => {
  it('rejects a plain request context that was not created for TrueFoundry', () => {
    expect(() => asTrueFoundryRequestContext(CONTEXT)).toThrow('TrueFoundry request context required');
  });
});

describe('accessTokenForRequest', () => {
  it('uses the caller token for catalog and gateway without an agent', async () => {
    const client = { vendToken: jest.fn() };
    const context = createTrueFoundryRequestContext(CONTEXT);

    const access = accessTokenForRequest({
      client,
      requestContext: context,
      agent: undefined,
      logger: LOGGER,
    });
    await expect(access.resolveServiceFoundryAuthorization()).resolves.toBe('caller-token');
    await expect(access.resolveGatewayAuthorization()).resolves.toEqual({
      type: 'caller',
      subjectToken: 'caller-token',
    });
    expect(client.vendToken).not.toHaveBeenCalled();
  });

  it('delegates a saved agent that still has the caller credential', async () => {
    const client = { vendToken: jest.fn().mockResolvedValue(VENDED) };
    const context = createTrueFoundryRequestContext(CONTEXT);

    const access = accessTokenForRequest({ client, requestContext: context, agent: AGENT, logger: LOGGER });
    await expect(access.resolveServiceFoundryAuthorization()).resolves.toBe('agent-token');
    await expect(access.resolveGatewayAuthorization()).resolves.toEqual({
      type: 'delegated',
      subjectToken: 'caller-token',
      actorToken: 'agent-token',
    });
    expect(client.vendToken).toHaveBeenCalledTimes(1);
  });

  it('shares one vend across model and MCP stores on the same request', async () => {
    const client = { vendToken: jest.fn().mockResolvedValue(VENDED) };
    const context = createTrueFoundryRequestContext(CONTEXT);

    const model = accessTokenForRequest({ client, requestContext: context, agent: AGENT, logger: LOGGER });
    const mcp = accessTokenForRequest({ client, requestContext: context, agent: AGENT, logger: LOGGER });

    expect(model).toBe(mcp);
    await expect(model.resolveServiceFoundryAuthorization()).resolves.toBe('agent-token');
    await expect(mcp.resolveGatewayAuthorization()).resolves.toEqual({
      type: 'delegated',
      subjectToken: 'caller-token',
      actorToken: 'agent-token',
    });
    expect(client.vendToken).toHaveBeenCalledTimes(1);
  });

  it('vends again on a later request for the same user and agent', async () => {
    const client = { vendToken: jest.fn().mockResolvedValue(VENDED) };
    const firstRequest = createTrueFoundryRequestContext(CONTEXT);
    const secondRequest = createTrueFoundryRequestContext(CONTEXT);

    await expect(
      accessTokenForRequest({
        client,
        requestContext: firstRequest,
        agent: AGENT,
        logger: LOGGER,
      }).resolveServiceFoundryAuthorization(),
    ).resolves.toBe('agent-token');
    await expect(
      accessTokenForRequest({
        client,
        requestContext: secondRequest,
        agent: AGENT,
        logger: LOGGER,
      }).resolveGatewayAuthorization(),
    ).resolves.toMatchObject({ type: 'delegated', subjectToken: 'caller-token' });
    expect(client.vendToken).toHaveBeenCalledTimes(2);
  });
});
