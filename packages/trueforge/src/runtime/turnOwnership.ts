import type { TurnState } from '@truefoundry/trueforge-core/agent-session';

/**
 * Result of a forward that did not itself finish the request.
 * A peer 200, 400, or 409 is returned directly and never becomes an outcome.
 */
export enum PeerOutcome {
  /** Heartbeat missing: the owner is gone. */
  NoResponder = 'no_responder',
  /** Publish-zero, timeout, 412, or transport failure. The owner is not known to be gone. */
  OwnerNotGone = 'owner_not_gone',
}

export enum TurnOwnershipAction {
  /** Handle on the local ActiveTurn. */
  Run = 'run',
  /** This replica owns the turn but has no ActiveTurn: rebuild it, then handle. */
  Rebuild = 'rebuild',
  /** Ask the owning replica to handle it. */
  Forward = 'forward',
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
    case PeerOutcome.NoResponder:
      return status === 'paused' ? TurnOwnershipAction.Steal : TurnOwnershipAction.Retry;
    case PeerOutcome.OwnerNotGone:
      return TurnOwnershipAction.Retry;
  }
}
