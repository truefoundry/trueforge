import type { TurnStreamData } from './server/events.js';
import type { AgentChatServer, PreviousTurnIdInput, TurnInputItem } from './server/types.js';

import { streamTurnEvents, type UserMessageContent } from './convertTurnMessages.js';
import { PeerThreadFoldState } from './foldPeerThreads.js';
import type { RequiredActionInput } from './requiredActionInputs.js';
import { throwIfAborted } from './streamReconnect.js';
import type { TurnStreamUpdate } from './turnStreamUpdate.js';

export interface StreamTurnOptions {
  userMessage?: UserMessageContent;
  resumeMcpAuth?: boolean;
  inputs?: RequiredActionInput[];
  /**
   * Branch anchor for createTurn. Omit for `"auto"`. Pass `"none"` for a fresh
   * root turn.
   */
  previousTurnId?: PreviousTurnIdInput;
  /** Extra headers for the turn request. */
  headers?: Record<string, string>;
}

function buildTurnInput(options: StreamTurnOptions): TurnInputItem[] {
  if (options.inputs != null) {
    return options.inputs;
  }
  if (options.resumeMcpAuth === true) {
    return [];
  }
  return [{ type: 'user.message', content: options.userMessage ?? '' }];
}

export async function* streamTurnContent(
  server: AgentChatServer,
  sessionId: string,
  foldState: PeerThreadFoldState,
  options: StreamTurnOptions,
  abortSignal: AbortSignal,
  groupRootBaseline?: readonly string[],
  /**
   * Called once with the turn ID as soon as it becomes available (first
   * `turn.created` SSE event). Use this to reconcile the locally-generated
   * optimistic ID with the real turn ID.
   */
  onTurnIdAvailable?: (turnId: string) => void,
  onSequenceNumber?: (sequenceNumber: number) => void,
): AsyncGenerator<TurnStreamUpdate> {
  // Aborting only detaches this client from the run; the turn keeps running on
  // the backend so switching sessions (or remounting) can reattach via
  // `subscribeToTurn`. Stopping the run is an explicit `cancelSession` call.
  throwIfAborted(abortSignal);

  let turnIdNotified = false;
  const notifyTurnId = (turnId: string) => {
    if (!turnIdNotified) {
      onTurnIdAvailable?.(turnId);
      turnIdNotified = true;
    }
  };

  const stream: AsyncIterable<TurnStreamData> = server.createTurn({
    sessionId,
    input: buildTurnInput(options),
    previousTurnId: options.previousTurnId ?? 'auto',
    abortSignal,
    ...(options.headers != null ? { headers: options.headers } : {}),
  });

  yield* streamTurnEvents(stream, foldState, groupRootBaseline, notifyTurnId, onSequenceNumber);
}

export async function* resumeTurnStream(
  server: AgentChatServer,
  sessionId: string,
  turnId: string,
  foldState: PeerThreadFoldState,
  abortSignal: AbortSignal,
  afterSequenceNumber?: number,
  groupRootBaseline?: readonly string[],
  onSequenceNumber?: (sequenceNumber: number) => void,
): AsyncGenerator<TurnStreamUpdate> {
  // Optional on custom backends. Callers detect the gap and report it, so an
  // empty stream here is safer than throwing mid-render.
  if (server.subscribeToTurn == null) {
    return;
  }

  throwIfAborted(abortSignal);

  yield* streamTurnEvents(
    server.subscribeToTurn({
      sessionId,
      turnId,
      ...(afterSequenceNumber != null ? { afterSequenceNumber } : {}),
      abortSignal,
    }),
    foldState,
    groupRootBaseline,
    undefined,
    onSequenceNumber,
  );
}
