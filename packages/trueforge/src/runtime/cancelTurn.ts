import type { ISessionStore, SessionHandle } from '@truefoundry/trueforge-core/agent-session';
import {
  CancellationReason,
  isNonTerminalTurnState,
  TurnNotFoundError,
} from '@truefoundry/trueforge-core/agent-session';
import { extractErrorLogFields } from '@truefoundry/trueforge-core/core';
import {
  redisRequest,
  RequestTimeoutError,
  type RedisClient,
  type RouteHandler as RequestReplyRouteHandler,
} from '@truefoundry/trueforge-core/request-reply';
import type { Logger } from 'winston';
import { z } from 'zod';
import configuration from '../config';
import type { ActiveTurnRegistry } from './activeTurns';

/** Request-reply path a replica serves to cancel a turn it owns. */
export const SESSIONS_CANCEL_PATH = 'sessions/cancel';

/** Wire body of a peer cancel; validated on receipt (it crosses processes via Redis). */
const CancelPeerBodySchema = z.object({
  session_id: z.string(),
  turn_id: z.string(),
  reason: z.enum(CancellationReason),
});
type CancelPeerBody = z.infer<typeof CancelPeerBodySchema>;

/**
 * Peer-facing cancel handler. 200 means the local run has finished, so its drain
 * has emitted `turn.done`. 412 means it is not running here.
 */
export function cancelSessionTurnPeerHandler(activeTurns: ActiveTurnRegistry): RequestReplyRouteHandler {
  return async request => {
    const parsed = CancelPeerBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return { status: 400, body: { message: 'Invalid sessions/cancel payload' } };
    }
    const found = await activeTurns.abortAndWait({
      sessionId: parsed.data.session_id,
      turnId: parsed.data.turn_id,
      abortReason: parsed.data.reason,
    });
    if (!found) {
      return { status: 412, body: { message: 'Turn is not running on this executor' } };
    }
    return { status: 200, body: {} };
  };
}

/** A registry to abort in, a session to freeze, durable state to read, and a way to reach peers. */
export interface CancelTurnDeps {
  activeTurns: ActiveTurnRegistry;
  session: Pick<SessionHandle, 'session_id' | 'freezeTurn'>;
  sessionStore: Pick<ISessionStore, 'getTurn'>;
  redis?: RedisClient | undefined;
  logger: Pick<Logger, 'warn'>;
}

/** Freeze a non-terminal turn; missing turns are a no-op (already gone). */
async function freezeTurnIgnoringMissing(
  session: Pick<SessionHandle, 'freezeTurn'>,
  input: { turnId: string; reason: CancellationReason },
): Promise<void> {
  try {
    await session.freezeTurn({ turn_id: input.turnId, reason: input.reason });
  } catch (error) {
    if (error instanceof TurnNotFoundError) {
      return;
    }
    throw error;
  }
}

/**
 * Cancels a `running` or `paused` turn wherever it lives: locally or on the
 * owning peer over Redis request-reply. Callers state the motive; default is a
 * plain client cancel.
 *
 * A confirmed abort (this process, or peer HTTP 200) lets TurnHandle persist
 * the terminal state. If abort cannot be confirmed, this replica freezes the
 * turn in the store so the session is not stuck `running` or `paused`.
 *
 * Redis timeout and Redis/transport failures are not a clean cancellation —
 * the owning replica may still be executing — but the turn is still frozen.
 * Later writes from that replica lose to first-terminal-write-wins.
 */
export async function cancelSessionTurn(
  deps: CancelTurnDeps,
  input: { turnId: string; reason?: CancellationReason },
): Promise<void> {
  const { turnId, reason = CancellationReason.ClientCancelled } = input;
  const sessionId = deps.session.session_id;

  const turn = await deps.sessionStore.getTurn({
    session_id: sessionId,
    turn_id: turnId,
  });
  if (!turn || !isNonTerminalTurnState(turn.state)) {
    return;
  }

  const owner = turn.active_executor_id;
  // Without a Redis client there is no peer to ask, so a different owner falls
  // through to the local lookup and freezes if the run is gone.
  if (owner !== configuration.EXECUTOR_ID && deps.redis) {
    try {
      const reply = await redisRequest<CancelPeerBody>({
        redis: deps.redis,
        executorId: owner,
        path: SESSIONS_CANCEL_PATH,
        request: {
          body: { session_id: sessionId, turn_id: turnId, reason },
        },
        options: {
          replyTimeoutMs: configuration.REDIS_REQUEST_REPLY_TIMEOUT_MS,
          pollIntervalMs: configuration.REDIS_REQUEST_REPLY_POLL_INTERVAL_MS,
        },
      });
      if (reply.status === 200) {
        return;
      }
    } catch (error) {
      const fields = {
        sessionId,
        turnId,
        owner,
        ...extractErrorLogFields(error),
      };
      if (error instanceof RequestTimeoutError) {
        deps.logger.warn('Timed out waiting for owning executor to cancel; freezing the turn', fields);
      } else {
        deps.logger.warn('Failed to reach owning executor over Redis; freezing the turn', fields);
      }
    }
    await freezeTurnIgnoringMissing(deps.session, { turnId, reason });
    return;
  }

  const aborted = deps.activeTurns.cancelIfRunning({
    sessionId,
    turnId,
    abortReason: reason,
  });
  if (!aborted) {
    await freezeTurnIgnoringMissing(deps.session, { turnId, reason });
  }
}
