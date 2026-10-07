import type { TurnState } from '@truefoundry/trueforge-core/agent-session';

/** Result of asking the owning replica to handle a turn request. */
export enum PeerOutcome {
  /** Peer replied 200 and handled the request. */
  Ok = 'ok',
  /** Heartbeat missing or nobody subscribed: the owner is gone. */
  NoResponder = 'no_responder',
  /** Heartbeat present but no reply in budget: the owner may still be applying. */
  Timeout = 'timeout',
  /** Peer is alive but has no ActiveTurn (412); it should rebuild, not us. */
  NotRunningOnPeer = 'not_running_on_peer',
  /** Redis/transport failed on this replica, so peer liveness is unknown. */
  TransportError = 'transport_error',
}

export enum TurnOwnershipAction {
  /** Handle on the local ActiveTurn. */
  Run = 'run',
  /** This replica owns the turn but has no ActiveTurn: rebuild it, then handle. */
  Rebuild = 'rebuild',
  /** Ask the owning replica to handle it. */
  Forward = 'forward',
  /** The owning replica handled it; nothing left to do here. */
  Forwarded = 'forwarded',
  /** Claim the paused turn from a dead owner; only the CAS winner rebuilds. */
  Steal = 'steal',
  /** The turn cannot accept this request (terminal, or running with its executor gone). */
  Reject = 'reject',
  /** Ownership cannot be resolved right now; the caller should retry later. */
  Retry = 'retry',
}

export interface TurnOwnershipInput {
  status: TurnState['status'];
  ownedByThisExecutor: boolean;
  hasLocalActiveTurn: boolean;
  /** `null` until the owning peer has been asked. */
  peerOutcome: PeerOutcome | null;
}

/**
 * Picks what to do with a send or wake request for a turn. Only picks: it does
 * not lock, claim, or call peers. Steals only a `paused` turn whose owner has
 * no responder, because a `running` owner may still be executing tools.
 */
export function resolveOwnershipAction(input: TurnOwnershipInput): TurnOwnershipAction {
  const { status, ownedByThisExecutor, hasLocalActiveTurn, peerOutcome } = input;

  if (status !== 'running' && status !== 'paused') {
    return TurnOwnershipAction.Reject;
  }

  if (ownedByThisExecutor) {
    if (hasLocalActiveTurn) {
      return TurnOwnershipAction.Run;
    }
    // A running turn without an ActiveTurn lost its executor; it is never resumed.
    return status === 'paused' ? TurnOwnershipAction.Rebuild : TurnOwnershipAction.Reject;
  }

  switch (peerOutcome) {
    case null:
      return TurnOwnershipAction.Forward;
    case PeerOutcome.Ok:
      return TurnOwnershipAction.Forwarded;
    case PeerOutcome.NoResponder:
      return status === 'paused' ? TurnOwnershipAction.Steal : TurnOwnershipAction.Retry;
    case PeerOutcome.Timeout:
    case PeerOutcome.NotRunningOnPeer:
    case PeerOutcome.TransportError:
      return TurnOwnershipAction.Retry;
  }
}
