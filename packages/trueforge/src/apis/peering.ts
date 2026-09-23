/**
 * Redis request-reply peering: locate/cancel handlers, peer reachability,
 * and turn-ownership resolution used by send/subscribe/cancel.
 */
import type { ISessionStore, TurnState } from '@truefoundry/trueforge-core/agent-session';
import { CancellationReason, TurnNotFoundError } from '@truefoundry/trueforge-core/agent-session';
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
 * - `steal` — table-only: claim the paused turn (resolveTurnOwnership then rebuilds or retries).
 * - `reject` — do not continue (turn terminal, or local running with no ActiveTurn).
 * - `retry` — do not continue now (remote owner not usable; caller may try again).
 */
export type OwnershipAction = 'run' | 'rebuild' | 'forward' | 'steal' | 'reject' | 'retry';

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
    if (input.peerResult === 'ok') {
      throw new Error('peerResult "ok" is only valid for a remote owner');
    }
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
 * Load the turn under the per-turn lock, peer if another replica owns it, then
 * {@link resolveOwnershipAction}. A `steal` is claimed here (R5): winner →
 * `rebuild`, loser → `retry`.
 */
export async function resolveTurnOwnership(
  deps: ResolveTurnOwnershipDeps,
  input: { sessionId: string; turnId: string },
): Promise<OwnershipAction> {
  return deps.activeTurns.withTurnLock({ sessionId: input.sessionId, turnId: input.turnId }, async () => {
    const turn = await deps.sessionStore.getTurn({
      session_id: input.sessionId,
      turn_id: input.turnId,
    });
    if (!turn) {
      throw new TurnNotFoundError(input.turnId);
    }

    const owner = turn.active_executor_id;
    const ownerIsLocal = owner === configuration.EXECUTOR_ID;
    const peerResult =
      !ownerIsLocal && deps.redis
        ? await callPeer({
            redis: deps.redis,
            executorId: owner,
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
    if (action !== 'steal') {
      return action;
    }

    const won = await deps.sessionStore.claimTurnOwnership({
      session_id: input.sessionId,
      turn_id: input.turnId,
      expected_active_executor_id: owner,
      new_active_executor_id: configuration.EXECUTOR_ID,
    });
    return won ? 'rebuild' : 'retry';
  });
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
