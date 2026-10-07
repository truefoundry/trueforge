import type { TurnState } from '@truefoundry/trueforge-core/agent-session';
import {
  PeerOutcome,
  resolveOwnershipAction,
  TurnOwnershipAction,
  type TurnOwnershipInput,
} from '../../../src/runtime/turnOwnership';

const TERMINAL_STATUSES: TurnState['status'][] = ['done', 'cancelled', 'error'];
const NON_TERMINAL_STATUSES: TurnState['status'][] = ['running', 'paused'];
const PEER_OUTCOMES: (PeerOutcome | null)[] = [null, ...Object.values(PeerOutcome)];

interface Row {
  name: string;
  input: TurnOwnershipInput;
  expected: TurnOwnershipAction;
}

const ROWS: Row[] = [
  {
    name: 'owner with a live ActiveTurn runs locally (running)',
    input: { status: 'running', ownedByThisExecutor: true, hasLocalActiveTurn: true, peerOutcome: null },
    expected: TurnOwnershipAction.Run,
  },
  {
    name: 'owner with a live ActiveTurn runs locally (paused, inside keepalive)',
    input: { status: 'paused', ownedByThisExecutor: true, hasLocalActiveTurn: true, peerOutcome: null },
    expected: TurnOwnershipAction.Run,
  },
  {
    name: 'owner without an ActiveTurn rebuilds a paused turn (not a steal)',
    input: { status: 'paused', ownedByThisExecutor: true, hasLocalActiveTurn: false, peerOutcome: null },
    expected: TurnOwnershipAction.Rebuild,
  },
  {
    name: 'owner without an ActiveTurn rejects a running turn (execute gone)',
    input: { status: 'running', ownedByThisExecutor: true, hasLocalActiveTurn: false, peerOutcome: null },
    expected: TurnOwnershipAction.Reject,
  },
  {
    name: 'non-owner forwards a paused turn before asking the peer',
    input: { status: 'paused', ownedByThisExecutor: false, hasLocalActiveTurn: false, peerOutcome: null },
    expected: TurnOwnershipAction.Forward,
  },
  {
    name: 'non-owner forwards a running turn before asking the peer',
    input: { status: 'running', ownedByThisExecutor: false, hasLocalActiveTurn: false, peerOutcome: null },
    expected: TurnOwnershipAction.Forward,
  },
  {
    name: 'peer 200 means the owner handled it',
    input: { status: 'paused', ownedByThisExecutor: false, hasLocalActiveTurn: false, peerOutcome: PeerOutcome.Ok },
    expected: TurnOwnershipAction.Forwarded,
  },
  {
    name: 'paused + no responder steals',
    input: {
      status: 'paused',
      ownedByThisExecutor: false,
      hasLocalActiveTurn: false,
      peerOutcome: PeerOutcome.NoResponder,
    },
    expected: TurnOwnershipAction.Steal,
  },
  {
    name: 'running + no responder never steals',
    input: {
      status: 'running',
      ownedByThisExecutor: false,
      hasLocalActiveTurn: false,
      peerOutcome: PeerOutcome.NoResponder,
    },
    expected: TurnOwnershipAction.Retry,
  },
  {
    name: 'paused + peer timeout does not steal (owner may still be applying)',
    input: {
      status: 'paused',
      ownedByThisExecutor: false,
      hasLocalActiveTurn: false,
      peerOutcome: PeerOutcome.Timeout,
    },
    expected: TurnOwnershipAction.Retry,
  },
  {
    name: 'paused + peer 412 does not steal (empty registry is not a dead executor)',
    input: {
      status: 'paused',
      ownedByThisExecutor: false,
      hasLocalActiveTurn: false,
      peerOutcome: PeerOutcome.NotRunningOnPeer,
    },
    expected: TurnOwnershipAction.Retry,
  },
  {
    name: 'paused + local transport error does not steal (cannot see heartbeats)',
    input: {
      status: 'paused',
      ownedByThisExecutor: false,
      hasLocalActiveTurn: false,
      peerOutcome: PeerOutcome.TransportError,
    },
    expected: TurnOwnershipAction.Retry,
  },
];

describe('resolveOwnershipAction', () => {
  it.each(ROWS)('$name', ({ input, expected }) => {
    expect(resolveOwnershipAction(input)).toBe(expected);
  });

  it('rejects every terminal turn regardless of ownership or peer outcome', () => {
    for (const status of TERMINAL_STATUSES) {
      for (const ownedByThisExecutor of [true, false]) {
        for (const hasLocalActiveTurn of [true, false]) {
          for (const peerOutcome of PEER_OUTCOMES) {
            expect(resolveOwnershipAction({ status, ownedByThisExecutor, hasLocalActiveTurn, peerOutcome })).toBe(
              TurnOwnershipAction.Reject,
            );
          }
        }
      }
    }
  });

  it('steals only for paused + no responder', () => {
    for (const status of NON_TERMINAL_STATUSES) {
      for (const ownedByThisExecutor of [true, false]) {
        for (const hasLocalActiveTurn of [true, false]) {
          for (const peerOutcome of PEER_OUTCOMES) {
            const action = resolveOwnershipAction({ status, ownedByThisExecutor, hasLocalActiveTurn, peerOutcome });
            const shouldSteal = status === 'paused' && !ownedByThisExecutor && peerOutcome === PeerOutcome.NoResponder;
            expect(action === TurnOwnershipAction.Steal).toBe(shouldSteal);
          }
        }
      }
    }
  });
});
