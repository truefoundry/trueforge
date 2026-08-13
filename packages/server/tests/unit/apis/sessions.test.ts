import type { ISessionStore, TurnRecord, TurnState } from '@truefoundry/trueforge-core/agent-session';
import { CancellationReason } from '@truefoundry/trueforge-core/agent-session';
import { HTTPException } from 'hono/http-exception';
import { createClient, type RedisClientType } from 'redis';
import { cancelSessionTurn } from '../../../src/apis/sessions';
import configuration from '../../../src/config';
import { ActiveTurnRegistry } from '../../../src/runtime/activeTurns';
import { mintPeeredTurnId } from '../../../src/runtime/peeringIds';

const SESSION_ID = 's1';

function turnRecord(turnId: string, state: TurnState): TurnRecord {
  return {
    turn_id: turnId,
    session_id: SESSION_ID,
    first_turn_id: turnId,
    ancestor_ids: [],
    previous_turn_id: null,
    state,
    input: [],
    snapshot: { threads: {}, mcp_servers: null, sandbox_info: null },
    created_at: new Date('2026-07-31T00:00:00.000Z'),
    updated_at: new Date('2026-07-31T00:00:00.000Z'),
    custom: null,
  };
}

/** Only `getTurn` is exercised, which is all CancelTurnDeps asks for. */
function storeReturning(turn: TurnRecord | undefined): Pick<ISessionStore, 'getTurn'> {
  return { getTurn: () => Promise.resolve(turn) };
}

/** Unconnected, so any attempt to reach a peer fails loudly instead of silently passing. */
function unconnectedRedis(): RedisClientType {
  const client: RedisClientType = createClient();
  return client;
}

/** Registers a live run without consuming its stream, mirroring a turn mid-execution. */
function trackRun(registry: ActiveTurnRegistry, turnId: string): AbortController {
  const abortController = new AbortController();
  registry.track({
    sessionId: SESSION_ID,
    turnId,
    abortController,
    stream: (async function* () {
      await new Promise(() => undefined);
      yield 'never';
    })(),
  });
  return abortController;
}

describe('cancelSessionTurn', () => {
  it('aborts a turn running in this process', async () => {
    const activeTurns = new ActiveTurnRegistry();
    const turnId = mintPeeredTurnId(configuration.EXECUTOR_ID);
    const abortController = trackRun(activeTurns, turnId);

    await cancelSessionTurn(
      {
        activeTurns,
        sessionStore: storeReturning(turnRecord(turnId, { status: 'running' })),
      },
      { sessionId: SESSION_ID, turnId },
    );

    expect(abortController.signal.aborted).toBe(true);
    expect(abortController.signal.reason).toBe(CancellationReason.ClientCancelled);
  });

  it('does not look for a peer without a Redis client', async () => {
    const activeTurns = new ActiveTurnRegistry();
    const turnId = mintPeeredTurnId('other1');

    // A peer hop here would dereference the absent client and throw.
    await expect(
      cancelSessionTurn(
        {
          activeTurns,
          sessionStore: storeReturning(turnRecord(turnId, { status: 'running' })),
        },
        { sessionId: SESSION_ID, turnId },
      ),
    ).resolves.toBeUndefined();
  });

  it('routes to the owning peer when the turn id names another replica', async () => {
    const activeTurns = new ActiveTurnRegistry();
    const turnId = mintPeeredTurnId('other1');

    // The unconnected client makes the hop fail; the point is that it happened.
    await expect(
      cancelSessionTurn(
        {
          activeTurns,
          sessionStore: storeReturning(turnRecord(turnId, { status: 'running' })),
          redis: unconnectedRedis(),
        },
        { sessionId: SESSION_ID, turnId },
      ),
    ).rejects.toBeInstanceOf(HTTPException);
  });
});
