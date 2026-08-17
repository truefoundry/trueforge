import type { ISessionStore, TurnRecord, TurnState } from '@truefoundry/trueforge-core/agent-session';
import { CancellationReason, TurnNotFoundError } from '@truefoundry/trueforge-core/agent-session';
import { NoResponderError, redisRequest, RequestTimeoutError } from '@truefoundry/trueforge-core/request-reply';
import type { RedisClientType } from 'redis';
import { cancelSessionTurn } from '../../../src/apis/sessions';
import configuration from '../../../src/config';
import { ActiveTurnRegistry } from '../../../src/runtime/activeTurns';
import { mintPeeredTurnId } from '../../../src/runtime/peeringIds';

jest.mock('@truefoundry/trueforge-core/request-reply', () => {
  const actual = jest.requireActual<typeof import('@truefoundry/trueforge-core/request-reply')>(
    '@truefoundry/trueforge-core/request-reply',
  );
  return {
    ...actual,
    redisRequest: jest.fn(),
  };
});

const redisRequestMock = jest.mocked(redisRequest);

const SESSION_ID = 's1';
const REDIS = {} as RedisClientType;

function silentLogger(): { warn: jest.Mock } {
  return { warn: jest.fn() };
}

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

function storeReturning(turn: TurnRecord | undefined): Pick<ISessionStore, 'getTurn' | 'freezeAndGetTurn'> {
  return {
    getTurn: () => Promise.resolve(turn),
    freezeAndGetTurn: jest.fn().mockResolvedValue(turn),
  };
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
  beforeEach(() => {
    redisRequestMock.mockReset();
  });

  it('aborts a turn running in this process without freezing', async () => {
    const activeTurns = new ActiveTurnRegistry();
    const turnId = mintPeeredTurnId(configuration.EXECUTOR_ID);
    const abortController = trackRun(activeTurns, turnId);
    const sessionStore = storeReturning(turnRecord(turnId, { status: 'running' }));

    await cancelSessionTurn({ activeTurns, sessionStore, logger: silentLogger() }, { sessionId: SESSION_ID, turnId });

    expect(abortController.signal.aborted).toBe(true);
    expect(abortController.signal.reason).toBe(CancellationReason.ClientCancelled);
    expect(sessionStore.freezeAndGetTurn).not.toHaveBeenCalled();
  });

  it('freezes when this executor owns the turn id but the run is gone', async () => {
    const activeTurns = new ActiveTurnRegistry();
    const turnId = mintPeeredTurnId(configuration.EXECUTOR_ID);
    const sessionStore = storeReturning(turnRecord(turnId, { status: 'running' }));

    await cancelSessionTurn({ activeTurns, sessionStore, logger: silentLogger() }, { sessionId: SESSION_ID, turnId });

    expect(sessionStore.freezeAndGetTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        session_id: SESSION_ID,
        turn_id: turnId,
        reason: CancellationReason.ClientCancelled,
      }),
    );
  });

  it('freezes when the run is not in this process and there is no Redis client', async () => {
    const activeTurns = new ActiveTurnRegistry();
    const turnId = mintPeeredTurnId('other1');
    const sessionStore = storeReturning(turnRecord(turnId, { status: 'running' }));

    await cancelSessionTurn({ activeTurns, sessionStore, logger: silentLogger() }, { sessionId: SESSION_ID, turnId });

    expect(sessionStore.freezeAndGetTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        session_id: SESSION_ID,
        turn_id: turnId,
        reason: CancellationReason.ClientCancelled,
      }),
    );
  });

  it('does not freeze when the owning peer aborts', async () => {
    const activeTurns = new ActiveTurnRegistry();
    const turnId = mintPeeredTurnId('other1');
    const sessionStore = storeReturning(turnRecord(turnId, { status: 'running' }));
    redisRequestMock.mockResolvedValue({ status: 200, body: {} });

    await cancelSessionTurn(
      { activeTurns, sessionStore, redis: REDIS, logger: silentLogger() },
      { sessionId: SESSION_ID, turnId },
    );

    expect(redisRequestMock).toHaveBeenCalled();
    expect(sessionStore.freezeAndGetTurn).not.toHaveBeenCalled();
  });

  it('freezes when the owning peer is alive but the turn is not running there', async () => {
    const activeTurns = new ActiveTurnRegistry();
    const turnId = mintPeeredTurnId('other1');
    const sessionStore = storeReturning(turnRecord(turnId, { status: 'running' }));
    redisRequestMock.mockResolvedValue({ status: 412, body: { message: 'Turn is not running on this executor' } });

    await cancelSessionTurn(
      { activeTurns, sessionStore, redis: REDIS, logger: silentLogger() },
      { sessionId: SESSION_ID, turnId },
    );

    expect(sessionStore.freezeAndGetTurn).toHaveBeenCalled();
  });

  it('freezes when the owning executor is unreachable', async () => {
    const activeTurns = new ActiveTurnRegistry();
    const turnId = mintPeeredTurnId('other1');
    const sessionStore = storeReturning(turnRecord(turnId, { status: 'running' }));
    const logger = silentLogger();
    redisRequestMock.mockRejectedValue(new NoResponderError('other1'));

    await expect(
      cancelSessionTurn({ activeTurns, sessionStore, redis: REDIS, logger }, { sessionId: SESSION_ID, turnId }),
    ).resolves.toBeUndefined();
    expect(sessionStore.freezeAndGetTurn).toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to reach owning executor over Redis; freezing the running turn',
      expect.objectContaining({ sessionId: SESSION_ID, turnId, owner: 'other1' }),
    );
  });

  it('freezes when waiting for the owning executor times out', async () => {
    const activeTurns = new ActiveTurnRegistry();
    const turnId = mintPeeredTurnId('other1');
    const sessionStore = storeReturning(turnRecord(turnId, { status: 'running' }));
    const logger = silentLogger();
    redisRequestMock.mockRejectedValue(new RequestTimeoutError(60_000));

    await expect(
      cancelSessionTurn({ activeTurns, sessionStore, redis: REDIS, logger }, { sessionId: SESSION_ID, turnId }),
    ).resolves.toBeUndefined();
    expect(sessionStore.freezeAndGetTurn).toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      'Timed out waiting for owning executor to cancel; freezing the running turn',
      expect.objectContaining({ sessionId: SESSION_ID, turnId, owner: 'other1' }),
    );
  });

  it('freezes when Redis itself cannot be reached', async () => {
    const activeTurns = new ActiveTurnRegistry();
    const turnId = mintPeeredTurnId('other1');
    const sessionStore = storeReturning(turnRecord(turnId, { status: 'running' }));
    const logger = silentLogger();
    redisRequestMock.mockRejectedValue(new Error('Redis connection closed'));

    await expect(
      cancelSessionTurn({ activeTurns, sessionStore, redis: REDIS, logger }, { sessionId: SESSION_ID, turnId }),
    ).resolves.toBeUndefined();
    expect(sessionStore.freezeAndGetTurn).toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to reach owning executor over Redis; freezing the running turn',
      expect.objectContaining({ sessionId: SESSION_ID, turnId, owner: 'other1', error: 'Redis connection closed' }),
    );
  });

  it('treats a missing turn as a successful cancel', async () => {
    const activeTurns = new ActiveTurnRegistry();
    const turnId = mintPeeredTurnId(configuration.EXECUTOR_ID);
    const sessionStore = storeReturning(turnRecord(turnId, { status: 'running' }));
    sessionStore.freezeAndGetTurn = jest.fn().mockRejectedValue(new TurnNotFoundError(turnId));

    await expect(
      cancelSessionTurn({ activeTurns, sessionStore, logger: silentLogger() }, { sessionId: SESSION_ID, turnId }),
    ).resolves.toBeUndefined();
  });
});
