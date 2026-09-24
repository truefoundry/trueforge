/**
 * Redis request-reply peering: locate/cancel handlers, peer reachability,
 * and turn-ownership resolution used by send/subscribe/cancel.
 */
import type { ISessionStore, TurnState } from '@truefoundry/trueforge-core/agent-session';
import {
  CancellationReason,
  parseActiveExecutorId,
  TurnNotFoundError,
} from '@truefoundry/trueforge-core/agent-session';
import {
  NoResponderError,
  redisRequest,
  type JSONValue,
  type RedisClient,
  type RouteHandler as RequestReplyRouteHandler,
  type RequestReplyRouter,
} from '@truefoundry/trueforge-core/request-reply';
import type { Logger } from 'winston';
import { z } from 'zod';
import configuration from '../config';
import type { ActiveTurnRegistry } from '../runtime/activeTurns';

/** Request-reply path a replica serves to cancel a turn it owns. */
export const SESSIONS_CANCEL_PATH = 'sessions/cancel';

/** Peer probe: does this executor have an ActiveTurn for the id? */
export const TURNS_LOCATE_PATH = 'turns/locate';

/** Wire body of a peer cancel; validated on receipt (it crosses processes via Redis). */
const CancelPeerBodySchema = z.object({
  session_id: z.string(),
  turn_id: z.string(),
  reason: z.enum(CancellationReason),
});

const LocatePeerBodySchema = z.object({
  session_id: z.string(),
  turn_id: z.string(),
});

/**
 * Outcome of a Redis request-reply to another executor (locate, cancel, …).
 * HTTP 200 → `ok`; heartbeat gone → `no_responder`; timeout / 412 / Redis is down → `failed`.
 */
export type PeerResult = 'ok' | 'no_responder' | 'failed';

/**
 * What this replica should do:
 *
 * - `run` — execute here (we own it and have an ActiveTurn).
 * - `rebuild` — rebuild ActiveTurn here (we own a paused turn with no run).
 * - `forward` — send the work to the remote owner.
 * - `steal` — claim the paused turn (CAS). Winner must rebuild under this lock (not yet).
 * - `reject` — do not continue (turn terminal, or local running with no ActiveTurn).
 * - `retry` — do not continue now (remote owner not usable; caller may try again).
 */
export type OwnershipAction = 'run' | 'rebuild' | 'forward' | 'steal' | 'reject' | 'retry';

export class OwnershipRejectedError extends Error {
  readonly action = 'reject' as const;
  constructor(message = 'Turn cannot continue on this replica') {
    super(message);
    this.name = 'OwnershipRejectedError';
  }
}

export class OwnershipRetryError extends Error {
  readonly action = 'retry' as const;
  constructor(message = 'This turn is temporarily unavailable. Please try again.') {
    super(message);
    this.name = 'OwnershipRetryError';
  }
}

export interface ResolveTurnOwnershipDeps {
  activeTurns: Pick<ActiveTurnRegistry, 'has' | 'withTurnLock'>;
  sessionStore: Pick<ISessionStore, 'getTurn' | 'claimTurnOwnership'>;
  redis?: RedisClient | undefined;
  logger: Pick<Logger, 'warn'>;
}

export function resolveOwnershipAction(input: {
  status: TurnState['status'];
  ownerIsLocal: boolean;
  hasActiveTurn: boolean;
  peerResult?: PeerResult;
}): OwnershipAction {
  if (input.status === 'cancelled' || input.status === 'done' || input.status === 'error') {
    return 'reject';
  }

  if (input.ownerIsLocal) {
    if (input.hasActiveTurn) {
      return 'run';
    }
    if (input.status === 'paused') {
      return 'rebuild';
    }
    return 'reject';
  }

  if (input.peerResult === 'ok') {
    return 'forward';
  }
  if (input.peerResult === 'no_responder' && input.status === 'paused') {
    return 'steal';
  }
  return 'retry';
}

/** Send a request-reply to `executorId`. Maps transport to {@link PeerResult}. */
export async function callPeer(input: {
  redis: RedisClient;
  executorId: string;
  path: string;
  body: JSONValue;
}): Promise<PeerResult> {
  try {
    const reply = await redisRequest({
      redis: input.redis,
      executorId: input.executorId,
      path: input.path,
      request: { body: input.body },
      options: {
        replyTimeoutMs: configuration.REDIS_REQUEST_REPLY_TIMEOUT_MS,
        pollIntervalMs: configuration.REDIS_REQUEST_REPLY_POLL_INTERVAL_MS,
      },
    });
    return reply.status === 200 ? 'ok' : 'failed';
  } catch (error) {
    return error instanceof NoResponderError ? 'no_responder' : 'failed';
  }
}

/**
 * Decide ownership under the per-turn lock (re-read + locate). Steal CAS
 * runs here. `true` — run here. `false` — request was forwarded. Throws
 * {@link OwnershipRejectedError} / {@link OwnershipRetryError}.
 * `rebuild` is not handled yet (must run under this same lock later).
 */
export async function resolveTurnOwnership(
  deps: ResolveTurnOwnershipDeps,
  input: {
    sessionId: string;
    turnId: string;
    /** Sent to the owning replica when the table says `forward`. */
    forward: { path: string; body: JSONValue };
  },
): Promise<boolean> {
  const decided = await deps.activeTurns.withTurnLock(
    { sessionId: input.sessionId, turnId: input.turnId },
    async () => {
      const turn = await deps.sessionStore.getTurn({
        session_id: input.sessionId,
        turn_id: input.turnId,
      });
      if (!turn) {
        throw new TurnNotFoundError(input.turnId);
      }

      const owner = turn.active_executor_id;
      const ownerExecutorId = parseActiveExecutorId(owner).executorId;
      const ownerIsLocal = ownerExecutorId === configuration.EXECUTOR_ID;
      const peerResult =
        !ownerIsLocal && deps.redis
          ? await callPeer({
              redis: deps.redis,
              executorId: ownerExecutorId,
              path: TURNS_LOCATE_PATH,
              body: { session_id: input.sessionId, turn_id: input.turnId },
            })
          : undefined;

      const action = resolveOwnershipAction({
        status: turn.state.status,
        ownerIsLocal,
        hasActiveTurn: deps.activeTurns.has({ sessionId: input.sessionId, turnId: input.turnId }),
        ...(peerResult === undefined ? {} : { peerResult }),
      });
      switch (action) {
        case 'run':
        case 'rebuild':
          // TODO: Implement run and rebuild.
          return undefined;
        case 'forward':
          return ownerExecutorId;
        case 'steal':
          await deps.sessionStore.claimTurnOwnership({
            session_id: input.sessionId,
            turn_id: input.turnId,
            expected_active_executor_id: owner,
            new_active_executor_id: configuration.EXECUTOR_ID,
          });
          // Winner still needs rebuild under this lock; not implemented yet.
          throw new OwnershipRetryError();
        case 'retry':
          throw new OwnershipRetryError();
        case 'reject':
          throw new OwnershipRejectedError();
      }
    },
  );

  if (decided === undefined) {
    return true;
  }
  if (!deps.redis) {
    throw new OwnershipRetryError();
  }
  const forwarded = await callPeer({
    redis: deps.redis,
    executorId: decided,
    path: input.forward.path,
    body: input.forward.body,
  });
  if (forwarded !== 'ok') {
    throw new OwnershipRetryError();
  }
  return false;
}

/**
 * Peer-facing locate: 200 if this process has an ActiveTurn, 412 if not.
 */
export function locateTurnPeerHandler(activeTurns: ActiveTurnRegistry): RequestReplyRouteHandler {
  return request => {
    const parsed = LocatePeerBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return Promise.resolve({ status: 400, body: { message: 'Invalid turns/locate payload' } });
    }
    const found = activeTurns.has({ sessionId: parsed.data.session_id, turnId: parsed.data.turn_id });
    return Promise.resolve(
      found ? { status: 200, body: {} } : { status: 412, body: { message: 'Turn is not on this executor' } },
    );
  };
}

/** Peer-facing cancel: 200 if we had the run and aborted, 412 if not here. */
export function cancelSessionTurnPeerHandler(activeTurns: ActiveTurnRegistry): RequestReplyRouteHandler {
  // Synchronous by nature; the transport expects a Promise and require-await
  // forbids an async fn without awaits.
  return request => {
    const parsed = CancelPeerBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return Promise.resolve({ status: 400, body: { message: 'Invalid sessions/cancel payload' } });
    }
    const found = activeTurns.has({ sessionId: parsed.data.session_id, turnId: parsed.data.turn_id });
    if (found) {
      activeTurns.cancel({
        sessionId: parsed.data.session_id,
        turnId: parsed.data.turn_id,
        abortReason: parsed.data.reason,
      });
    }
    return Promise.resolve(
      found ? { status: 200, body: {} } : { status: 412, body: { message: 'Turn is not running on this executor' } },
    );
  };
}

export function registerPeerRoutes(requestReplyRouter: RequestReplyRouter, activeTurns: ActiveTurnRegistry): void {
  requestReplyRouter.registerRoute(SESSIONS_CANCEL_PATH, cancelSessionTurnPeerHandler(activeTurns));
  requestReplyRouter.registerRoute(TURNS_LOCATE_PATH, locateTurnPeerHandler(activeTurns));
}
