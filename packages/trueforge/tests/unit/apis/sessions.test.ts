import type {
  ISessionStore,
  SessionHandle,
  TurnHandle,
  TurnRecord,
  TurnState,
} from '@truefoundry/trueforge-core/agent-session';
import { CancellationReason, TurnNotFoundError } from '@truefoundry/trueforge-core/agent-session';
import { NoResponderError, redisRequest, RequestTimeoutError } from '@truefoundry/trueforge-core/request-reply';
import type { RedisClientType } from 'redis';
import { cancelSessionTurn, cancelSessionTurnPeerHandler } from '../../../src/apis/sessions';
import configuration from '../../../src/config';
import { ActiveTurnRegistry } from '../../../src/runtime/activeTurns';

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
const REMOTE_EXECUTOR = 'other1';

function silentLogger(): { warn: jest.Mock } {
  return { warn: jest.fn() };
}

function turnRecord(input: { turnId: string; state: TurnState; activeExecutorId?: string }): TurnRecord {
  return {
    turn_id: input.turnId,
    session_id: SESSION_ID,
    first_turn_id: input.turnId,
    ancestor_ids: [],
    previous_turn_id: null,
    active_executor_id: input.activeExecutorId ?? configuration.EXECUTOR_ID,
    state: input.state,
    input: [],
    snapshot: { threads: {}, mcp_servers: null, sandbox_info: null },
    created_at: new Date('2026-07-31T00:00:00.000Z'),
    updated_at: new Date('2026-07-31T00:00:00.000Z'),
    custom: null,
  };
}

function storeReturning(turn: TurnRecord | undefined): Pick<ISessionStore, 'getTurn'> {
  return { getTurn: () => Promise.resolve(turn) };
}

function sessionHandle(): Pick<SessionHandle, 'session_id' | 'freezeTurn'> {
  return {
    session_id: SESSION_ID,
    freezeTurn: jest.fn().mockResolvedValue(undefined),
  };
}

function cancelDeps(input: {
  activeTurns: ActiveTurnRegistry;
  turn: TurnRecord | undefined;
  session?: Pick<SessionHandle, 'session_id' | 'freezeTurn'>;
  redis?: RedisClientType;
  logger?: { warn: jest.Mock };
}): {
  activeTurns: ActiveTurnRegistry;
  session: Pick<SessionHandle, 'session_id' | 'freezeTurn'>;
  sessionStore: Pick<ISessionStore, 'getTurn'>;
  redis?: RedisClientType;
  logger: { warn: jest.Mock };
} {
  return {
    activeTurns: input.activeTurns,
    session: input.session ?? sessionHandle(),
    sessionStore: storeReturning(input.turn),
    ...(input.redis === undefined ? {} : { redis: input.redis }),
    logger: input.logger ?? silentLogger(),
  };
}

/** Registers a live run without consuming its stream, mirroring a turn mid-execution. */
function trackRun(registry: ActiveTurnRegistry, turnId: string): AbortController {
  const abortController = new AbortController();
  registry.track({
    turn: { session_id: SESSION_ID, id: turnId } as TurnHandle,
    abortController,
    stream: (async function* () {
      await new Promise(() => undefined);
      yield 'never';
    })(),
  });
  return abortController;
}

function flushAsync(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

/** Holds the turn lock until `release` is called, standing in for an in-flight inbound-events POST. */
function holdTurnLock(registry: ActiveTurnRegistry, turnId: string): { release: () => void; held: Promise<undefined> } {
  const gate = Promise.withResolvers<undefined>();
  const held = registry.withTurnLock({ sessionId: SESSION_ID, turnId }, () => gate.promise);
  return { release: () => gate.resolve(undefined), held };
}

describe('cancelSessionTurn', () => {
  beforeEach(() => {
    redisRequestMock.mockReset();
  });

  it('aborts a turn running in this process without freezing', async () => {
    const activeTurns = new ActiveTurnRegistry();
    const turnId = 'turn-local-running';
    const abortController = trackRun(activeTurns, turnId);
    const session = sessionHandle();

    await cancelSessionTurn(
      cancelDeps({ activeTurns, turn: turnRecord({ turnId: turnId, state: { status: 'running' } }), session }),
      {
        turnId,
      },
    );

    expect(abortController.signal.aborted).toBe(true);
    expect(abortController.signal.reason).toBe(CancellationReason.ClientCancelled);
    expect(session.freezeTurn).not.toHaveBeenCalled();
  });

  it('freezes when this executor owns the turn but the run is gone', async () => {
    const activeTurns = new ActiveTurnRegistry();
    const turnId = 'turn-local-gone';
    const session = sessionHandle();

    await cancelSessionTurn(
      cancelDeps({ activeTurns, turn: turnRecord({ turnId: turnId, state: { status: 'running' } }), session }),
      {
        turnId,
      },
    );

    expect(session.freezeTurn).toHaveBeenCalledWith({
      turn_id: turnId,
      reason: CancellationReason.ClientCancelled,
    });
  });

  it('freezes when the run is not in this process and there is no Redis client', async () => {
    const activeTurns = new ActiveTurnRegistry();
    const turnId = 'turn-remote-no-redis';
    const session = sessionHandle();

    await cancelSessionTurn(
      cancelDeps({
        activeTurns,
        turn: turnRecord({ turnId: turnId, state: { status: 'running' }, activeExecutorId: REMOTE_EXECUTOR }),
        session,
      }),
      { turnId },
    );

    expect(session.freezeTurn).toHaveBeenCalledWith({
      turn_id: turnId,
      reason: CancellationReason.ClientCancelled,
    });
  });

  it('does not freeze when the owning peer aborts', async () => {
    const activeTurns = new ActiveTurnRegistry();
    const turnId = 'turn-remote-ok';
    const session = sessionHandle();
    redisRequestMock.mockResolvedValue({ status: 200, body: {} });

    await cancelSessionTurn(
      cancelDeps({
        activeTurns,
        turn: turnRecord({ turnId: turnId, state: { status: 'running' }, activeExecutorId: REMOTE_EXECUTOR }),
        session,
        redis: REDIS,
      }),
      { turnId },
    );

    expect(redisRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        executorId: REMOTE_EXECUTOR,
      }),
    );
    expect(session.freezeTurn).not.toHaveBeenCalled();
  });

  it('freezes when the owning peer is alive but the turn is not running there', async () => {
    const activeTurns = new ActiveTurnRegistry();
    const turnId = 'turn-remote-412';
    const session = sessionHandle();
    redisRequestMock.mockResolvedValue({ status: 412, body: { message: 'Turn is not running on this executor' } });

    await cancelSessionTurn(
      cancelDeps({
        activeTurns,
        turn: turnRecord({ turnId: turnId, state: { status: 'running' }, activeExecutorId: REMOTE_EXECUTOR }),
        session,
        redis: REDIS,
      }),
      { turnId },
    );

    expect(session.freezeTurn).toHaveBeenCalled();
  });

  it('freezes when the owning executor is unreachable', async () => {
    const activeTurns = new ActiveTurnRegistry();
    const turnId = 'turn-remote-no-responder';
    const session = sessionHandle();
    const logger = silentLogger();
    redisRequestMock.mockRejectedValue(new NoResponderError(REMOTE_EXECUTOR));

    await expect(
      cancelSessionTurn(
        cancelDeps({
          activeTurns,
          turn: turnRecord({ turnId: turnId, state: { status: 'running' }, activeExecutorId: REMOTE_EXECUTOR }),
          session,
          redis: REDIS,
          logger,
        }),
        { turnId },
      ),
    ).resolves.toBeUndefined();
    expect(session.freezeTurn).toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to reach owning executor over Redis; freezing the running turn',
      expect.objectContaining({ sessionId: SESSION_ID, turnId, owner: REMOTE_EXECUTOR }),
    );
  });

  it('freezes when waiting for the owning executor times out', async () => {
    const activeTurns = new ActiveTurnRegistry();
    const turnId = 'turn-remote-timeout';
    const session = sessionHandle();
    const logger = silentLogger();
    redisRequestMock.mockRejectedValue(new RequestTimeoutError(60_000));

    await expect(
      cancelSessionTurn(
        cancelDeps({
          activeTurns,
          turn: turnRecord({ turnId: turnId, state: { status: 'running' }, activeExecutorId: REMOTE_EXECUTOR }),
          session,
          redis: REDIS,
          logger,
        }),
        { turnId },
      ),
    ).resolves.toBeUndefined();
    expect(session.freezeTurn).toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      'Timed out waiting for owning executor to cancel; freezing the running turn',
      expect.objectContaining({ sessionId: SESSION_ID, turnId, owner: REMOTE_EXECUTOR }),
    );
  });

  it('freezes when Redis itself cannot be reached', async () => {
    const activeTurns = new ActiveTurnRegistry();
    const turnId = 'turn-remote-redis-down';
    const session = sessionHandle();
    const logger = silentLogger();
    redisRequestMock.mockRejectedValue(new Error('Redis connection closed'));

    await expect(
      cancelSessionTurn(
        cancelDeps({
          activeTurns,
          turn: turnRecord({ turnId: turnId, state: { status: 'running' }, activeExecutorId: REMOTE_EXECUTOR }),
          session,
          redis: REDIS,
          logger,
        }),
        { turnId },
      ),
    ).resolves.toBeUndefined();
    expect(session.freezeTurn).toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to reach owning executor over Redis; freezing the running turn',
      expect.objectContaining({
        sessionId: SESSION_ID,
        turnId,
        owner: REMOTE_EXECUTOR,
        error: 'Redis connection closed',
      }),
    );
  });

  it('waits for the turn lock before freezing a locally owned turn', async () => {
    const activeTurns = new ActiveTurnRegistry();
    const turnId = 'turn-locked';
    const session = sessionHandle();
    const lock = holdTurnLock(activeTurns, turnId);

    const cancel = cancelSessionTurn(
      cancelDeps({ activeTurns, turn: turnRecord({ turnId, state: { status: 'running' } }), session }),
      { turnId },
    );
    await flushAsync();
    expect(session.freezeTurn).not.toHaveBeenCalled();

    lock.release();
    await Promise.all([lock.held, cancel]);
    expect(session.freezeTurn).toHaveBeenCalledWith({
      turn_id: turnId,
      reason: CancellationReason.ClientCancelled,
    });
  });

  it('treats a missing turn as a successful cancel', async () => {
    const activeTurns = new ActiveTurnRegistry();
    const turnId = 'turn-missing';
    const session = sessionHandle();
    session.freezeTurn = jest.fn().mockRejectedValue(new TurnNotFoundError(turnId));

    await expect(
      cancelSessionTurn(
        cancelDeps({ activeTurns, turn: turnRecord({ turnId: turnId, state: { status: 'running' } }), session }),
        {
          turnId,
        },
      ),
    ).resolves.toBeUndefined();
  });
});

describe('cancelSessionTurnPeerHandler', () => {
  it('aborts the local run only after the turn lock is released', async () => {
    const activeTurns = new ActiveTurnRegistry();
    const turnId = 'turn-peer-locked';
    const abortController = trackRun(activeTurns, turnId);
    const lock = holdTurnLock(activeTurns, turnId);

    const reply = cancelSessionTurnPeerHandler(activeTurns)({
      body: { session_id: SESSION_ID, turn_id: turnId, reason: CancellationReason.ClientCancelled },
    });
    await flushAsync();
    expect(abortController.signal.aborted).toBe(false);

    lock.release();
    await expect(reply).resolves.toEqual({ status: 200, body: {} });
    expect(abortController.signal.aborted).toBe(true);
    await lock.held;
  });
});
