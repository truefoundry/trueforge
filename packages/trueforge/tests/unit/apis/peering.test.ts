import type { ISessionStore, TurnRecord, TurnState } from '@truefoundry/trueforge-core/agent-session';
import { TurnNotFoundError } from '@truefoundry/trueforge-core/agent-session';
import { NoResponderError, redisRequest, RequestTimeoutError } from '@truefoundry/trueforge-core/request-reply';
import type { RedisClientType } from 'redis';
import {
  OwnershipRejectedError,
  OwnershipRetryError,
  resolveOwnershipAction,
  resolveTurnOwnership,
  TURNS_LOCATE_PATH,
  type OwnershipAction,
  type PeerResult,
} from '../../../src/apis/peering';
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
const SEND_PATH = 'turns/send';
const pausedState = { status: 'paused' as const, action_required_on_events: [] };

function ownershipInput(turnId: string): {
  sessionId: string;
  turnId: string;
  forward: { path: string; body: { session_id: string; turn_id: string } };
} {
  return {
    sessionId: SESSION_ID,
    turnId,
    forward: { path: SEND_PATH, body: { session_id: SESSION_ID, turn_id: turnId } },
  };
}

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

function storeReturning(
  turn: TurnRecord | undefined,
  claimTurnOwnership: ISessionStore['claimTurnOwnership'] = () => Promise.resolve(true),
): Pick<ISessionStore, 'getTurn' | 'claimTurnOwnership'> {
  return {
    getTurn: () => Promise.resolve(turn),
    claimTurnOwnership,
  };
}

function ownershipDeps(input: {
  activeTurns: ActiveTurnRegistry;
  turn: TurnRecord | undefined;
  redis?: RedisClientType;
  logger?: { warn: jest.Mock };
  claimTurnOwnership?: ISessionStore['claimTurnOwnership'];
}): {
  activeTurns: ActiveTurnRegistry;
  sessionStore: Pick<ISessionStore, 'getTurn' | 'claimTurnOwnership'>;
  redis?: RedisClientType;
  logger: { warn: jest.Mock };
} {
  return {
    activeTurns: input.activeTurns,
    sessionStore: storeReturning(input.turn, input.claimTurnOwnership),
    ...(input.redis === undefined ? {} : { redis: input.redis }),
    logger: input.logger ?? silentLogger(),
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

describe('resolveTurnOwnership', () => {
  beforeEach(() => {
    redisRequestMock.mockReset();
  });

  it('throws when the turn is missing', async () => {
    await expect(
      resolveTurnOwnership(
        ownershipDeps({ activeTurns: new ActiveTurnRegistry(), turn: undefined }),
        ownershipInput('missing'),
      ),
    ).rejects.toBeInstanceOf(TurnNotFoundError);
  });

  it('runs locally when this executor owns a live ActiveTurn', async () => {
    const activeTurns = new ActiveTurnRegistry();
    const turnId = 'turn-local';
    trackRun(activeTurns, turnId);

    await expect(
      resolveTurnOwnership(
        ownershipDeps({
          activeTurns,
          turn: turnRecord({ turnId, state: { status: 'running' } }),
        }),
        ownershipInput(turnId),
      ),
    ).resolves.toBe(true);
  });

  it('rejects a local running turn with no ActiveTurn', async () => {
    await expect(
      resolveTurnOwnership(
        ownershipDeps({
          activeTurns: new ActiveTurnRegistry(),
          turn: turnRecord({ turnId: 'gone-local', state: { status: 'running' } }),
        }),
        ownershipInput('gone-local'),
      ),
    ).rejects.toBeInstanceOf(OwnershipRejectedError);
  });

  it('retries when a local rebuild would be needed (not handled yet)', async () => {
    await expect(
      resolveTurnOwnership(
        ownershipDeps({
          activeTurns: new ActiveTurnRegistry(),
          turn: turnRecord({ turnId: 'paused-local', state: pausedState }),
        }),
        ownershipInput('paused-local'),
      ),
    ).rejects.toBeInstanceOf(OwnershipRetryError);
  });

  it('forwards the request when the owning replica still has the turn', async () => {
    redisRequestMock.mockResolvedValue({ status: 200, body: {} });

    await expect(
      resolveTurnOwnership(
        ownershipDeps({
          activeTurns: new ActiveTurnRegistry(),
          turn: turnRecord({ turnId: 'remote-ok', state: pausedState, activeExecutorId: REMOTE_EXECUTOR }),
          redis: REDIS,
        }),
        ownershipInput('remote-ok'),
      ),
    ).resolves.toBe(false);
    expect(redisRequestMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ executorId: REMOTE_EXECUTOR, path: TURNS_LOCATE_PATH }),
    );
    expect(redisRequestMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ executorId: REMOTE_EXECUTOR, path: SEND_PATH }),
    );
  });

  it('retries when the forwarded request fails', async () => {
    redisRequestMock
      .mockResolvedValueOnce({ status: 200, body: {} })
      .mockResolvedValueOnce({ status: 412, body: { message: 'Turn is not on this executor' } });

    await expect(
      resolveTurnOwnership(
        ownershipDeps({
          activeTurns: new ActiveTurnRegistry(),
          turn: turnRecord({ turnId: 'remote-forward-fail', state: pausedState, activeExecutorId: REMOTE_EXECUTOR }),
          redis: REDIS,
        }),
        ownershipInput('remote-forward-fail'),
      ),
    ).rejects.toBeInstanceOf(OwnershipRetryError);
  });

  it('retries when locate is 412 / timeout (unavailable)', async () => {
    redisRequestMock.mockResolvedValue({ status: 412, body: { message: 'Turn is not on this executor' } });

    await expect(
      resolveTurnOwnership(
        ownershipDeps({
          activeTurns: new ActiveTurnRegistry(),
          turn: turnRecord({ turnId: 'remote-412', state: pausedState, activeExecutorId: REMOTE_EXECUTOR }),
          redis: REDIS,
        }),
        ownershipInput('remote-412'),
      ),
    ).rejects.toBeInstanceOf(OwnershipRetryError);
  });

  it('claims a paused turn with no responder, then retries (rebuild not handled yet)', async () => {
    redisRequestMock.mockRejectedValue(new NoResponderError(REMOTE_EXECUTOR));
    const claimTurnOwnership = jest.fn().mockResolvedValue(true);

    await expect(
      resolveTurnOwnership(
        ownershipDeps({
          activeTurns: new ActiveTurnRegistry(),
          turn: turnRecord({ turnId: 'remote-steal', state: pausedState, activeExecutorId: REMOTE_EXECUTOR }),
          redis: REDIS,
          claimTurnOwnership,
        }),
        ownershipInput('remote-steal'),
      ),
    ).rejects.toBeInstanceOf(OwnershipRetryError);
    expect(claimTurnOwnership).toHaveBeenCalledWith({
      session_id: SESSION_ID,
      turn_id: 'remote-steal',
      expected_active_executor_id: REMOTE_EXECUTOR,
      new_active_executor_id: configuration.EXECUTOR_ID,
    });
  });

  it('retries when the steal CAS loses', async () => {
    redisRequestMock.mockRejectedValue(new NoResponderError(REMOTE_EXECUTOR));
    const claimTurnOwnership = jest.fn().mockResolvedValue(false);

    await expect(
      resolveTurnOwnership(
        ownershipDeps({
          activeTurns: new ActiveTurnRegistry(),
          turn: turnRecord({ turnId: 'remote-steal-lose', state: pausedState, activeExecutorId: REMOTE_EXECUTOR }),
          redis: REDIS,
          claimTurnOwnership,
        }),
        ownershipInput('remote-steal-lose'),
      ),
    ).rejects.toBeInstanceOf(OwnershipRetryError);
    expect(claimTurnOwnership).toHaveBeenCalled();
  });

  it('does not steal a running turn when there is no responder', async () => {
    redisRequestMock.mockRejectedValue(new NoResponderError(REMOTE_EXECUTOR));
    const claimTurnOwnership = jest.fn();

    await expect(
      resolveTurnOwnership(
        ownershipDeps({
          activeTurns: new ActiveTurnRegistry(),
          turn: turnRecord({
            turnId: 'remote-running',
            state: { status: 'running' },
            activeExecutorId: REMOTE_EXECUTOR,
          }),
          redis: REDIS,
          claimTurnOwnership,
        }),
        ownershipInput('remote-running'),
      ),
    ).rejects.toBeInstanceOf(OwnershipRetryError);
    expect(claimTurnOwnership).not.toHaveBeenCalled();
  });

  it('does not steal on peer timeout', async () => {
    redisRequestMock.mockRejectedValue(new RequestTimeoutError(60_000));
    const claimTurnOwnership = jest.fn();

    await expect(
      resolveTurnOwnership(
        ownershipDeps({
          activeTurns: new ActiveTurnRegistry(),
          turn: turnRecord({ turnId: 'remote-timeout', state: pausedState, activeExecutorId: REMOTE_EXECUTOR }),
          redis: REDIS,
          claimTurnOwnership,
        }),
        ownershipInput('remote-timeout'),
      ),
    ).rejects.toBeInstanceOf(OwnershipRetryError);
    expect(claimTurnOwnership).not.toHaveBeenCalled();
  });
});

describe('resolveOwnershipAction', () => {
  it.each([
    {
      name: 'local paused with ActiveTurn → run here',
      input: { status: 'paused' as const, ownerIsLocal: true, hasActiveTurn: true },
      expect: 'run' satisfies OwnershipAction,
    },
    {
      name: 'local paused without ActiveTurn → run here (rebuild)',
      input: { status: 'paused' as const, ownerIsLocal: true, hasActiveTurn: false },
      expect: 'rebuild' satisfies OwnershipAction,
    },
    {
      name: 'local running with ActiveTurn → run here',
      input: { status: 'running' as const, ownerIsLocal: true, hasActiveTurn: true },
      expect: 'run' satisfies OwnershipAction,
    },
    {
      name: 'local running without ActiveTurn → reject',
      input: { status: 'running' as const, ownerIsLocal: true, hasActiveTurn: false },
      expect: 'reject' satisfies OwnershipAction,
    },
    {
      name: 'remote + ok → forward',
      input: {
        status: 'paused' as const,
        ownerIsLocal: false,
        hasActiveTurn: false,
        peerResult: 'ok' as const,
      },
      expect: 'forward' satisfies OwnershipAction,
    },
    {
      name: 'remote paused + no_responder → steal',
      input: {
        status: 'paused' as const,
        ownerIsLocal: false,
        hasActiveTurn: false,
        peerResult: 'no_responder' as PeerResult,
      },
      expect: 'steal' satisfies OwnershipAction,
    },
    {
      name: 'remote paused + failed → retry (no steal)',
      input: {
        status: 'paused' as const,
        ownerIsLocal: false,
        hasActiveTurn: false,
        peerResult: 'failed' as PeerResult,
      },
      expect: 'retry' satisfies OwnershipAction,
    },
    {
      name: 'remote running + no_responder → retry (no steal)',
      input: {
        status: 'running' as const,
        ownerIsLocal: false,
        hasActiveTurn: false,
        peerResult: 'no_responder' as PeerResult,
      },
      expect: 'retry' satisfies OwnershipAction,
    },
    {
      name: 'cancelled → reject',
      input: { status: 'cancelled' as const, ownerIsLocal: true, hasActiveTurn: false },
      expect: 'reject' satisfies OwnershipAction,
    },
    {
      name: 'done → reject',
      input: { status: 'done' as const, ownerIsLocal: true, hasActiveTurn: false },
      expect: 'reject' satisfies OwnershipAction,
    },
  ])('$name', ({ input, expect: expected }) => {
    expect(resolveOwnershipAction(input)).toEqual(expected);
  });

  it('throws if ok is passed for a local owner', () => {
    expect(() =>
      resolveOwnershipAction({
        status: 'running',
        ownerIsLocal: true,
        hasActiveTurn: true,
        peerResult: 'ok',
      }),
    ).toThrow('peerResult "ok" is only valid for a remote owner');
  });
});
