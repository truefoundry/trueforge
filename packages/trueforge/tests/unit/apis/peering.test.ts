import type { ISessionStore, TurnRecord, TurnState } from '@truefoundry/trueforge-core/agent-session';
import { TurnNotFoundError } from '@truefoundry/trueforge-core/agent-session';
import { NoResponderError, redisRequest, RequestTimeoutError } from '@truefoundry/trueforge-core/request-reply';
import type { RedisClientType } from 'redis';
import {
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
const pausedState = { status: 'paused' as const, action_required_on_events: [] };

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

function ownershipDeps(input: {
  activeTurns: ActiveTurnRegistry;
  turn: TurnRecord | undefined;
  redis?: RedisClientType;
  logger?: { warn: jest.Mock };
}): {
  activeTurns: ActiveTurnRegistry;
  sessionStore: Pick<ISessionStore, 'getTurn'>;
  redis?: RedisClientType;
  logger: { warn: jest.Mock };
} {
  return {
    activeTurns: input.activeTurns,
    sessionStore: storeReturning(input.turn),
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
      resolveTurnOwnership(ownershipDeps({ activeTurns: new ActiveTurnRegistry(), turn: undefined }), {
        sessionId: SESSION_ID,
        turnId: 'missing',
      }),
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
        { sessionId: SESSION_ID, turnId },
      ),
    ).resolves.toBe('run');
  });

  it('rebuilds when this executor owns a paused turn with no ActiveTurn', async () => {
    await expect(
      resolveTurnOwnership(
        ownershipDeps({
          activeTurns: new ActiveTurnRegistry(),
          turn: turnRecord({ turnId: 'paused-local', state: pausedState }),
        }),
        { sessionId: SESSION_ID, turnId: 'paused-local' },
      ),
    ).resolves.toBe('rebuild');
  });

  it('returns forward when the owning replica still has the turn', async () => {
    redisRequestMock.mockResolvedValue({ status: 200, body: {} });

    await expect(
      resolveTurnOwnership(
        ownershipDeps({
          activeTurns: new ActiveTurnRegistry(),
          turn: turnRecord({ turnId: 'remote-ok', state: pausedState, activeExecutorId: REMOTE_EXECUTOR }),
          redis: REDIS,
        }),
        { sessionId: SESSION_ID, turnId: 'remote-ok' },
      ),
    ).resolves.toBe('forward');
    expect(redisRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({ executorId: REMOTE_EXECUTOR, path: TURNS_LOCATE_PATH }),
    );
  });

  it('does not steal on 412 / timeout (unavailable)', async () => {
    redisRequestMock.mockResolvedValue({ status: 412, body: { message: 'Turn is not on this executor' } });

    await expect(
      resolveTurnOwnership(
        ownershipDeps({
          activeTurns: new ActiveTurnRegistry(),
          turn: turnRecord({ turnId: 'remote-412', state: pausedState, activeExecutorId: REMOTE_EXECUTOR }),
          redis: REDIS,
        }),
        { sessionId: SESSION_ID, turnId: 'remote-412' },
      ),
    ).resolves.toBe('retry');
  });

  it('steals a paused turn when there is no responder', async () => {
    redisRequestMock.mockRejectedValue(new NoResponderError(REMOTE_EXECUTOR));

    await expect(
      resolveTurnOwnership(
        ownershipDeps({
          activeTurns: new ActiveTurnRegistry(),
          turn: turnRecord({ turnId: 'remote-steal', state: pausedState, activeExecutorId: REMOTE_EXECUTOR }),
          redis: REDIS,
        }),
        { sessionId: SESSION_ID, turnId: 'remote-steal' },
      ),
    ).resolves.toBe('steal');
  });

  it('does not steal a running turn when there is no responder', async () => {
    redisRequestMock.mockRejectedValue(new NoResponderError(REMOTE_EXECUTOR));

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
        }),
        { sessionId: SESSION_ID, turnId: 'remote-running' },
      ),
    ).resolves.toBe('retry');
  });

  it('does not steal on peer timeout', async () => {
    redisRequestMock.mockRejectedValue(new RequestTimeoutError(60_000));

    await expect(
      resolveTurnOwnership(
        ownershipDeps({
          activeTurns: new ActiveTurnRegistry(),
          turn: turnRecord({ turnId: 'remote-timeout', state: pausedState, activeExecutorId: REMOTE_EXECUTOR }),
          redis: REDIS,
        }),
        { sessionId: SESSION_ID, turnId: 'remote-timeout' },
      ),
    ).resolves.toBe('retry');
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
