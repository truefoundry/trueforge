import { CancellationReason, InMemorySessionStore, Sessions } from '@truefoundry/trueforge-core/agent-session';
import { createLogger } from 'winston';
import {
  makeAgentSpec,
  makeCreateTurnInput,
  makeTurnCreatedEvent,
} from '../../../../trueforge-core/tests/agent-session/testHelpers';
import { createAbandonedTurnsRouter } from '../../../src/apis/abandonedTurns';
import configuration from '../../../src/config';
import { ActiveTurnRegistry } from '../../../src/runtime/activeTurns';

const TENANT = 'default';
const SESSION_ID = 'abandoned-session';
const logger = createLogger({ silent: true });

describe('abandoned turns internal API', () => {
  async function setup() {
    const sessionStore = new InMemorySessionStore();
    const sessions = new Sessions({ sessionStore });
    const activeTurns = new ActiveTurnRegistry();
    await sessionStore.createSession({
      tenant_id: TENANT,
      session_id: SESSION_ID,
      created_by_subject: { subject_id: 'user-1', subject_type: 'user', subject_display_name: 'user-1' },
      agent: { type: 'inline', spec: makeAgentSpec() },
      custom: null,
      metadata: {},
      external_id: null,
      source: null,
    });
    const router = createAbandonedTurnsRouter({
      sessionStore,
      sessions,
      activeTurns,
      logger,
    });
    return { sessionStore, sessions, router };
  }

  it('lists only stale running turns and closes them as abandoned', async () => {
    const { sessionStore, router } = await setup();
    const staleAt = new Date(Date.now() - configuration.ABANDONED_TURN_STALE_MS - 60_000).toISOString();
    const freshAt = new Date().toISOString();

    await sessionStore.createTurn(makeCreateTurnInput({ sessionId: SESSION_ID, turnId: 'stale-1' }));
    await sessionStore.appendToEvents({
      session_id: SESSION_ID,
      turn_id: 'stale-1',
      events: [{ ...makeTurnCreatedEvent('stale-1'), created_at: staleAt }],
    });

    await sessionStore.createTurn(
      makeCreateTurnInput({
        sessionId: SESSION_ID,
        turnId: 'fresh-1',
        previousTurnId: null,
        firstTurnId: 'fresh-1',
      }),
    );
    await sessionStore.appendToEvents({
      session_id: SESSION_ID,
      turn_id: 'fresh-1',
      events: [{ ...makeTurnCreatedEvent('fresh-1'), created_at: freshAt }],
    });

    const listRes = await router.request('/abandoned');
    expect(listRes.status).toBe(200);
    expect(await listRes.json()).toEqual({
      data: [{ tenant_id: TENANT, session_id: SESSION_ID, turn_id: 'stale-1' }],
    });

    const closeRes = await router.request('/close-abandoned', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tenant_id: TENANT,
        session_id: SESSION_ID,
        turn_id: 'stale-1',
      }),
    });
    expect(closeRes.status).toBe(204);

    const closed = await sessionStore.getTurn({ session_id: SESSION_ID, turn_id: 'stale-1' });
    expect(closed?.state).toMatchObject({
      status: 'cancelled',
      reason: CancellationReason.Abandoned,
    });

    const fresh = await sessionStore.getTurn({ session_id: SESSION_ID, turn_id: 'fresh-1' });
    expect(fresh?.state.status).toBe('running');

    const listAfter = await router.request('/abandoned');
    expect(listAfter.status).toBe(200);
    expect(await listAfter.json()).toEqual({ data: [] });
  });

  it('returns 404 when closing a missing session', async () => {
    const { router } = await setup();
    const response = await router.request('/close-abandoned', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tenant_id: TENANT,
        session_id: 'missing-session',
        turn_id: 'turn-1',
      }),
    });
    expect(response.status).toBe(404);
  });

  it('close is a no-op 204 when the turn is already terminal', async () => {
    const { sessionStore, router } = await setup();
    const staleAt = new Date(Date.now() - configuration.ABANDONED_TURN_STALE_MS - 60_000).toISOString();
    await sessionStore.createTurn(makeCreateTurnInput({ sessionId: SESSION_ID, turnId: 'done-1' }));
    await sessionStore.appendToEvents({
      session_id: SESSION_ID,
      turn_id: 'done-1',
      events: [{ ...makeTurnCreatedEvent('done-1'), created_at: staleAt }],
    });
    await sessionStore.updateTurnTerminalState({
      session_id: SESSION_ID,
      turn_id: 'done-1',
      state: {
        status: 'done',
        output: null,
        required_actions: [],
        completed_at: new Date().toISOString(),
      },
      turn_done_event: {
        type: 'turn.done',
        id: 'evt-done-1',
        created_at: new Date().toISOString(),
        state: {
          status: 'done',
          output: null,
          required_actions: [],
          completed_at: new Date().toISOString(),
        },
        thread_id: null,
      },
    });

    const response = await router.request('/close-abandoned', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tenant_id: TENANT,
        session_id: SESSION_ID,
        turn_id: 'done-1',
      }),
    });
    expect(response.status).toBe(204);
    const turn = await sessionStore.getTurn({ session_id: SESSION_ID, turn_id: 'done-1' });
    expect(turn?.state.status).toBe('done');
  });
});
