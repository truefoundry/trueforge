import { AgentSpecSchema } from '@truefoundry/trueforge-core/agent-session';
import { HTTPException } from 'hono/http-exception';
import type { RequestContext } from '../../../src/auth/identity';
import type { AgentRecord } from '../../../src/db/agentStore';
import {
  accessTokenForRequest,
  agentAccessToken,
  asTrueFoundryRequestContext,
  callerAccessToken,
  createTrueFoundryRequestContext,
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

describe('agentAccessToken', () => {
  it('vends dual tokens scoped to the agent, naming the caller as the subject', async () => {
    const client = { vendToken: jest.fn().mockResolvedValue(VENDED) };
    const logger = { info: jest.fn() };

    const tokens = agentAccessToken({ client, requestContext: CONTEXT, agent: AGENT, logger });
    await expect(tokens.asAgent()).resolves.toBe('agent-token');
    await expect(tokens.asUser()).resolves.toBe('user-token');
    expect(logger.info).toHaveBeenCalledWith('Exchanging user context for agent access token', {
      subject: 'user-1',
      agentId: 'ext-agent',
    });
    expect(client.vendToken).toHaveBeenCalledWith({
      subject: CONTEXT.subject,
      agentId: 'ext-agent',
      tenantName: 'acme',
    });
  });

  it('vends once and reuses both tokens for later calls', async () => {
    const client = { vendToken: jest.fn().mockResolvedValue(VENDED) };
    const tokens = agentAccessToken({ client, requestContext: CONTEXT, agent: AGENT, logger: LOGGER });

    await expect(Promise.all([tokens.asAgent(), tokens.asUser(), tokens.asAgent()])).resolves.toEqual([
      'agent-token',
      'user-token',
      'agent-token',
    ]);
    expect(client.vendToken).toHaveBeenCalledTimes(1);
  });

  it('vends again after a failed exchange', async () => {
    const client = {
      vendToken: jest.fn().mockRejectedValueOnce(new Error('vend failed')).mockResolvedValue(VENDED),
    };
    const tokens = agentAccessToken({ client, requestContext: CONTEXT, agent: AGENT, logger: LOGGER });

    await expect(tokens.asAgent()).rejects.toThrow('vend failed');
    await expect(tokens.asUser()).resolves.toBe('user-token');
    expect(client.vendToken).toHaveBeenCalledTimes(2);
  });

  it('rejects with 422 when the agent was never registered with TrueFoundry', () => {
    const client = { vendToken: jest.fn() };

    expect(() =>
      agentAccessToken({
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
  it('uses the caller token for both identities without an agent', async () => {
    const client = { vendToken: jest.fn() };
    const context = createTrueFoundryRequestContext(CONTEXT);

    const tokens = accessTokenForRequest({
      client,
      requestContext: context,
      agent: undefined,
      logger: LOGGER,
    });
    await expect(tokens.asAgent()).resolves.toBe('caller-token');
    await expect(tokens.asUser()).resolves.toBe('caller-token');
    expect(tokens.asAgent).toBe(tokens.asUser);
    expect(client.vendToken).not.toHaveBeenCalled();
  });

  it('maps vend actorToken to asAgent and subjectToken to asUser', async () => {
    const client = { vendToken: jest.fn().mockResolvedValue(VENDED) };
    const context = createTrueFoundryRequestContext(CONTEXT);

    const tokens = accessTokenForRequest({ client, requestContext: context, agent: AGENT, logger: LOGGER });
    await expect(tokens.asAgent()).resolves.toBe('agent-token');
    await expect(tokens.asUser()).resolves.toBe('user-token');
    expect(client.vendToken).toHaveBeenCalledTimes(1);
  });

  it('shares one vend across model and MCP stores on the same request', async () => {
    const client = { vendToken: jest.fn().mockResolvedValue(VENDED) };
    const context = createTrueFoundryRequestContext(CONTEXT);

    const model = accessTokenForRequest({ client, requestContext: context, agent: AGENT, logger: LOGGER });
    const mcp = accessTokenForRequest({ client, requestContext: context, agent: AGENT, logger: LOGGER });

    expect(model).toBe(mcp);
    await expect(Promise.all([model.asAgent(), mcp.asUser(), model.asUser()])).resolves.toEqual([
      'agent-token',
      'user-token',
      'user-token',
    ]);
    expect(client.vendToken).toHaveBeenCalledTimes(1);
  });

  it('vends again on a later request for the same user and agent', async () => {
    const client = { vendToken: jest.fn().mockResolvedValue(VENDED) };
    const firstRequest = createTrueFoundryRequestContext(CONTEXT);
    const secondRequest = createTrueFoundryRequestContext(CONTEXT);

    await expect(
      accessTokenForRequest({ client, requestContext: firstRequest, agent: AGENT, logger: LOGGER }).asAgent(),
    ).resolves.toBe('agent-token');
    await expect(
      accessTokenForRequest({ client, requestContext: secondRequest, agent: AGENT, logger: LOGGER }).asUser(),
    ).resolves.toBe('user-token');
    expect(client.vendToken).toHaveBeenCalledTimes(2);
  });
});
