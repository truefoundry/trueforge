/**
 * Sends inbound events to the turn that owns them: the local machine, a rebuild
 * of a paused turn this replica owns, or a peer. Steal is a conditional claim
 * after the owner's heartbeat is gone.
 */
import type {
  ISessionStore,
  SessionHandle,
  TurnHandle,
  TurnUserEvent,
} from '@truefoundry/trueforge-core/agent-session';
import {
  TurnEventAlreadyExistsError,
  TurnOwnershipLostError,
  TurnUserEventSchema,
} from '@truefoundry/trueforge-core/agent-session';
import { AgentHarnessError } from '@truefoundry/trueforge-core/core';
import {
  jsonValueFrom,
  NO_RESPONDER_PUBLISH_DETAIL,
  NoResponderError,
  redisRequest,
  RequestTimeoutError,
  type RedisClient,
} from '@truefoundry/trueforge-core/request-reply';
import type { Logger } from 'winston';
import { z } from 'zod';
import type { RequestContext } from '../auth/identity';
import configuration from '../config';
import type { ActiveTurnRegistry } from './activeTurns';
import { PeerOutcome, resolveOwnershipAction, TurnOwnershipAction } from './turnOwnership';

/** Request-reply path the owner serves for inbound turn events. */
export const TURNS_SEND_EVENTS_PATH = 'turns/send-events';

const MAX_OWNERSHIP_ATTEMPTS = 4;

const PeerRequestContextSchema = z.object({
  tenant_id: z.string(),
  subject: z.object({
    id: z.string(),
    type: z.string(),
    display_name: z.string(),
  }),
  roles: z.array(z.string()),
  user_credential: z.string().nullable(),
});

export const SendEventsPeerBodySchema = z.object({
  tenant_id: z.string(),
  session_id: z.string(),
  turn_id: z.string(),
  events: z.array(TurnUserEventSchema),
  request_context: PeerRequestContextSchema,
  request_headers: z.record(z.string(), z.string()).optional(),
});

const PeerEventsReplySchema = z.object({
  events: z.array(TurnUserEventSchema),
});

const PeerMessageSchema = z.object({
  message: z.string(),
});

export type TurnDeliveryResult =
  | { type: 'applied'; events: TurnUserEvent[] }
  | { type: 'invalid'; message: string }
  | { type: 'conflict'; message: string }
  | { type: 'unavailable'; message: string }
  | { type: 'not_owner' };

export async function deliverTurnEvents(input: {
  session: SessionHandle;
  sessionStore: Pick<ISessionStore, 'claimTurnExecutor' | 'insertTurnInboundEvents'>;
  activeTurns: ActiveTurnRegistry;
  turnId: string;
  events: TurnUserEvent[];
  redis: RedisClient | undefined;
  logger: Pick<Logger, 'warn'>;
  /**
   * Rebuild the paused turn this replica owns. Do not start execute yet:
   * the caller queues this request's events first, then starts the drain.
   */
  resume: () => Promise<{ turn: TurnHandle; startDrain: () => void }>;
  /** Peer delivery is owner-local. Only the replica that received the client request may steal. */
  allowSteal: boolean;
  requestContext: RequestContext;
  requestHeaders?: Record<string, string> | undefined;
}): Promise<TurnDeliveryResult> {
  const sessionId = input.session.session_id;

  for (let attempt = 0; attempt < MAX_OWNERSHIP_ATTEMPTS; attempt++) {
    const loaded = await input.session.getTurn(input.turnId);
    if (!loaded) {
      return { type: 'conflict', message: `Turn not found: ${input.turnId}` };
    }
    const status = loaded.state.status;
    const owner = loaded.active_executor_id;
    const ownedByThisExecutor = owner === configuration.EXECUTOR_ID;

    if (!ownedByThisExecutor) {
      await input.activeTurns.dropLocalTurn({ sessionId, turnId: input.turnId });
    }

    if (!input.allowSteal && !ownedByThisExecutor) {
      return { type: 'not_owner' };
    }

    const hasLocalActiveTurn = input.activeTurns.getTurnHandle({ sessionId, turnId: input.turnId }) !== undefined;
    let action = resolveOwnershipAction({
      status,
      ownedByThisExecutor,
      hasLocalActiveTurn,
      peerOutcome: null,
    });

    if (action === TurnOwnershipAction.Forward) {
      const forwarded = await forwardTurnEvents({
        redis: input.redis,
        owner,
        sessionId,
        turnId: input.turnId,
        events: input.events,
        requestContext: input.requestContext,
        requestHeaders: input.requestHeaders,
        logger: input.logger,
      });
      if (forwarded.type !== 'peer') {
        return forwarded;
      }
      const fresh = await input.session.getTurn(input.turnId);
      const freshStatus = fresh?.state.status ?? status;
      const freshOwner = fresh?.active_executor_id ?? owner;
      if (forwarded.peerOutcome === PeerOutcome.NoResponder && (freshStatus !== 'paused' || freshOwner !== owner)) {
        continue;
      }
      action = resolveOwnershipAction({
        status: freshStatus,
        ownedByThisExecutor: freshOwner === configuration.EXECUTOR_ID,
        hasLocalActiveTurn: false,
        peerOutcome: forwarded.peerOutcome,
      });
      if (
        action === TurnOwnershipAction.Forward ||
        action === TurnOwnershipAction.Run ||
        action === TurnOwnershipAction.Rebuild
      ) {
        continue;
      }
    }

    if (action === TurnOwnershipAction.Run) {
      const handle = input.activeTurns.getTurnHandle({ sessionId, turnId: input.turnId });
      if (!handle) {
        continue;
      }
      // Drop the pause timer before wake. If it fired while this handler held the lock,
      // the callback sees the timer was replaced and does not offload. A send that leaves
      // the turn paused rearms; a later `running` update clears that timer from the drain.
      input.activeTurns.clearPausedKeepalive({ sessionId, turnId: input.turnId });
      try {
        return await applyTurnEvents({
          handle,
          events: input.events,
          sessionStore: input.sessionStore,
          sessionId,
          turnId: input.turnId,
        });
      } finally {
        if (handle.state.status === 'paused') {
          input.activeTurns.startPausedKeepalive({ sessionId, turnId: input.turnId });
        }
      }
    }

    if (action === TurnOwnershipAction.Rebuild || action === TurnOwnershipAction.Steal) {
      if (action === TurnOwnershipAction.Steal) {
        const won = await input.sessionStore.claimTurnExecutor({
          session_id: sessionId,
          turn_id: input.turnId,
          expected_executor_id: owner,
          new_executor_id: configuration.EXECUTOR_ID,
        });
        if (!won) {
          continue;
        }
      }
      try {
        const resumed = await input.resume();
        try {
          return await applyTurnEvents({
            handle: resumed.turn,
            events: input.events,
            sessionStore: input.sessionStore,
            sessionId,
            turnId: input.turnId,
          });
        } finally {
          resumed.startDrain();
        }
      } catch (error) {
        if (error instanceof TurnOwnershipLostError) {
          continue;
        }
        throw error;
      }
    }

    if (action === TurnOwnershipAction.Reject) {
      return {
        type: 'conflict',
        message:
          status === 'running'
            ? `Turn is running but its executor is gone: ${input.turnId}`
            : `Turn is not accepting events: ${input.turnId}`,
      };
    }

    return { type: 'unavailable', message: `Turn owner is unavailable: ${input.turnId}` };
  }

  return { type: 'unavailable', message: `Turn ownership did not settle: ${input.turnId}` };
}

async function applyTurnEvents(input: {
  handle: TurnHandle;
  events: TurnUserEvent[];
  sessionStore: Pick<ISessionStore, 'insertTurnInboundEvents'>;
  sessionId: string;
  turnId: string;
}): Promise<TurnDeliveryResult> {
  try {
    for await (const batch of input.handle.send(input.events)) {
      await input.sessionStore.insertTurnInboundEvents({
        session_id: input.sessionId,
        turn_id: input.turnId,
        events: batch,
      });
    }
  } catch (error) {
    if (error instanceof AgentHarnessError && error.code === 'invalid_send_input') {
      return { type: 'invalid', message: error.message };
    }
    if (error instanceof TurnEventAlreadyExistsError) {
      return { type: 'conflict', message: error.message };
    }
    throw error;
  }
  return { type: 'applied', events: input.events };
}

type ForwardResult = TurnDeliveryResult | { type: 'peer'; peerOutcome: PeerOutcome };

async function forwardTurnEvents(input: {
  redis: RedisClient | undefined;
  owner: string;
  sessionId: string;
  turnId: string;
  events: TurnUserEvent[];
  requestContext: RequestContext;
  requestHeaders?: Record<string, string> | undefined;
  logger: Pick<Logger, 'warn'>;
}): Promise<ForwardResult> {
  if (!input.redis) {
    return { type: 'unavailable', message: `Turn owner is unavailable: ${input.turnId}` };
  }
  const { requestContext } = input;
  const body = SendEventsPeerBodySchema.parse({
    tenant_id: requestContext.tenant_id,
    session_id: input.sessionId,
    turn_id: input.turnId,
    events: input.events,
    request_context: {
      tenant_id: requestContext.tenant_id,
      subject: requestContext.subject,
      roles: requestContext.roles,
      user_credential: requestContext.user_credential,
    },
    ...(input.requestHeaders === undefined ? {} : { request_headers: input.requestHeaders }),
  });
  try {
    const reply = await redisRequest({
      redis: input.redis,
      executorId: input.owner,
      path: TURNS_SEND_EVENTS_PATH,
      request: { body: jsonValueFrom(body) },
      options: {
        replyTimeoutMs: configuration.REDIS_REQUEST_REPLY_TIMEOUT_MS,
        pollIntervalMs: configuration.REDIS_REQUEST_REPLY_POLL_INTERVAL_MS,
      },
    });
    if (reply.status === 200) {
      const parsed = PeerEventsReplySchema.safeParse(reply.body);
      if (!parsed.success) {
        return { type: 'unavailable', message: `Turn owner is unavailable: ${input.turnId}` };
      }
      return { type: 'applied', events: parsed.data.events };
    }
    if (reply.status === 412) {
      return { type: 'peer', peerOutcome: PeerOutcome.OwnerNotGone };
    }
    if (reply.status === 409 || reply.status === 400) {
      const parsed = PeerMessageSchema.safeParse(reply.body);
      return {
        type: reply.status === 400 ? 'invalid' : 'conflict',
        message: parsed.success ? parsed.data.message : `Turn is not accepting events: ${input.turnId}`,
      };
    }
    return { type: 'unavailable', message: `Turn owner is unavailable: ${input.turnId}` };
  } catch (error) {
    if (error instanceof NoResponderError) {
      if (error.detail === NO_RESPONDER_PUBLISH_DETAIL) {
        return { type: 'peer', peerOutcome: PeerOutcome.OwnerNotGone };
      }
      return { type: 'peer', peerOutcome: PeerOutcome.NoResponder };
    }
    if (error instanceof RequestTimeoutError) {
      return { type: 'peer', peerOutcome: PeerOutcome.OwnerNotGone };
    }
    input.logger.warn('Failed to reach owning executor for turn events', {
      sessionId: input.sessionId,
      turnId: input.turnId,
      owner: input.owner,
    });
    return { type: 'peer', peerOutcome: PeerOutcome.OwnerNotGone };
  }
}
