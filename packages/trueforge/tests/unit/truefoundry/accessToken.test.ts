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

const AGENT: AgentRecord = {
  id: 'agent-1',
  tenant_id: 'acme',
  name: 'named',
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
  it('vends a token scoped to the agent, naming the caller as the subject', async () => {
    const client = { vendToken: jest.fn().mockResolvedValue('agent-token') };

    await expect(agentAccessToken({ client, context: CONTEXT, agent: AGENT })()).resolves.toBe('agent-token');
    expect(client.vendToken).toHaveBeenCalledWith({
      subject: CONTEXT.subject,
      agentId: 'ext-agent',
      tenantName: 'acme',
    });
  });

  it('vends once and reuses the token for later calls', async () => {
    const client = { vendToken: jest.fn().mockResolvedValue('agent-token') };
    const resolve = agentAccessToken({ client, context: CONTEXT, agent: AGENT });

    await expect(Promise.all([resolve(), resolve()])).resolves.toEqual(['agent-token', 'agent-token']);
    await expect(resolve()).resolves.toBe('agent-token');
    expect(client.vendToken).toHaveBeenCalledTimes(1);
  });

  it('vends again after a failed exchange', async () => {
    const client = {
      vendToken: jest.fn().mockRejectedValueOnce(new Error('vend failed')).mockResolvedValue('agent-token'),
    };
    const resolve = agentAccessToken({ client, context: CONTEXT, agent: AGENT });

    await expect(resolve()).rejects.toThrow('vend failed');
    await expect(resolve()).resolves.toBe('agent-token');
    expect(client.vendToken).toHaveBeenCalledTimes(2);
  });

  it('rejects with 422 when the agent was never registered with TrueFoundry', () => {
    const client = { vendToken: jest.fn() };

    expect(() => agentAccessToken({ client, context: CONTEXT, agent: { ...AGENT, external_id: null } })).toThrow(
      HTTPException,
    );
    expect(client.vendToken).not.toHaveBeenCalled();
  });
});

describe('asTrueFoundryRequestContext', () => {
  it('rejects a plain request context that was not created for TrueFoundry', () => {
    expect(() => asTrueFoundryRequestContext(CONTEXT)).toThrow('TrueFoundry request context required');
  });
});

describe('accessTokenForRequest', () => {
  it('rejects a plain request context that was not created for TrueFoundry', () => {
    const client = { vendToken: jest.fn() };

    expect(() => accessTokenForRequest({ client, context: CONTEXT, agent: AGENT })).toThrow(
      'TrueFoundry request context required',
    );
    expect(client.vendToken).not.toHaveBeenCalled();
  });
  it('uses the caller token without an agent', async () => {
    const client = { vendToken: jest.fn() };
    const context = createTrueFoundryRequestContext(CONTEXT);

    await expect(accessTokenForRequest({ client, context, agent: undefined })()).resolves.toBe('caller-token');
    expect(client.vendToken).not.toHaveBeenCalled();
  });

  it('uses a vended token with an agent', async () => {
    const client = { vendToken: jest.fn().mockResolvedValue('agent-token') };
    const context = createTrueFoundryRequestContext(CONTEXT);

    await expect(accessTokenForRequest({ client, context, agent: AGENT })()).resolves.toBe('agent-token');
    expect(client.vendToken).toHaveBeenCalledTimes(1);
  });

  it('shares one vend across stores on the same request', async () => {
    const client = { vendToken: jest.fn().mockResolvedValue('agent-token') };
    const context = createTrueFoundryRequestContext(CONTEXT);

    const model = accessTokenForRequest({ client, context, agent: AGENT });
    const mcp = accessTokenForRequest({ client, context, agent: AGENT });

    expect(model).toBe(mcp);
    await expect(Promise.all([model(), mcp()])).resolves.toEqual(['agent-token', 'agent-token']);
    expect(client.vendToken).toHaveBeenCalledTimes(1);
  });

  it('vends again on a later request for the same user and agent', async () => {
    const client = { vendToken: jest.fn().mockResolvedValue('agent-token') };
    const firstRequest = createTrueFoundryRequestContext(CONTEXT);
    const secondRequest = createTrueFoundryRequestContext(CONTEXT);

    await expect(accessTokenForRequest({ client, context: firstRequest, agent: AGENT })()).resolves.toBe('agent-token');
    await expect(accessTokenForRequest({ client, context: secondRequest, agent: AGENT })()).resolves.toBe(
      'agent-token',
    );
    expect(client.vendToken).toHaveBeenCalledTimes(2);
  });
});
