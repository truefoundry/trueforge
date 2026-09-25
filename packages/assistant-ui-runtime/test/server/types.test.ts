import { describe, expect, it } from 'vitest';

import type {
  AgentChatServer,
  PermissionsServer,
  SendTurnEventsRequest,
  TurnUpdateStatePaused,
} from '../../src/server/index.js';
import { EVENT_TYPE, TOOL_APPROVAL_POLICY_ACTION_TYPE, TURN_STATUS } from '../../src/server/index.js';

describe('PermissionsServer', () => {
  it('supports USE grants for agents', async () => {
    const server: PermissionsServer = {
      listPermissions: async () => ({
        data: { type: 'agent', permissions: { agent: ['USE'] } },
      }),
    };

    await expect(server.listPermissions({ resourceType: 'agent', resourceIds: ['agent'] })).resolves.toEqual({
      data: { type: 'agent', permissions: { agent: ['USE'] } },
    });
  });

  it('supports tenant CREATE grants keyed by entity kind', async () => {
    const server: PermissionsServer = {
      listPermissions: async () => ({
        data: { type: 'tenant', permissions: { agent: ['CREATE'] } },
      }),
    };

    await expect(server.listPermissions({ resourceType: 'tenant', resourceIds: [] })).resolves.toEqual({
      data: { type: 'tenant', permissions: { agent: ['CREATE'] } },
    });
  });
});

describe('AgentChatServer turn events', () => {
  it('keeps action submission separate from turn creation', async () => {
    const sendTurnEvents: AgentChatServer['sendTurnEvents'] = async request =>
      request.events.map((event, index) => ({
        ...event,
        id: `event-${String(index)}`,
        createdAt: '2026-09-24T00:00:00.000Z',
      }));

    const request = {
      sessionId: 'session-1',
      turnId: 'turn-1',
      events: [
        { type: EVENT_TYPE.USER_MCP_AUTH_CONTINUE },
        {
          type: EVENT_TYPE.USER_TOOL_APPROVAL_POLICY,
          policies: [
            {
              serverName: 'github',
              name: 'create_issue',
              action: { type: TOOL_APPROVAL_POLICY_ACTION_TYPE.ALLOW_SESSION },
            },
          ],
        },
      ],
    } satisfies SendTurnEventsRequest;

    await expect(sendTurnEvents(request)).resolves.toEqual([
      {
        type: EVENT_TYPE.USER_MCP_AUTH_CONTINUE,
        id: 'event-0',
        createdAt: '2026-09-24T00:00:00.000Z',
      },
      {
        type: EVENT_TYPE.USER_TOOL_APPROVAL_POLICY,
        policies: [
          {
            serverName: 'github',
            name: 'create_issue',
            action: { type: TOOL_APPROVAL_POLICY_ACTION_TYPE.ALLOW_SESSION },
          },
        ],
        id: 'event-1',
        createdAt: '2026-09-24T00:00:00.000Z',
      },
    ]);
  });

  it('shares the canonical paused state across turn and update contracts', () => {
    const paused: TurnUpdateStatePaused = {
      status: TURN_STATUS.PAUSED,
      actionRequiredOnEvents: [{ id: 'approval-required-1' }],
    };

    expect(paused.status).toBe(TURN_STATUS.PAUSED);
  });
});
