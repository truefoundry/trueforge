import { sql } from 'kysely';

import { createSqliteDb } from '../../../../../src/db/sqlite/client';
import { up } from '../../../../../src/db/sqlite/migrations/20261006_000001_turn_done_approval_to_paused';

const approvalRequired = {
  type: 'tool.approval_required',
  id: 'approval-1',
  thread_id: 'main',
  tool_call_id: 'call-1',
};

function doneState(requiredActions: object[] = []) {
  return {
    status: 'done',
    output: null,
    required_actions: requiredActions,
    completed_at: '2026-10-06T00:00:00.000Z',
  };
}

const errorState = {
  status: 'error',
  message: 'failed',
  completed_at: '2026-10-06T00:00:00.000Z',
};

function turnDoneEvent(id: string, state: object) {
  return {
    type: 'turn.done',
    id,
    state,
    created_at: '2026-10-06T00:00:00.000Z',
    thread_id: null,
  };
}

describe('SQLite done approval turn migration', () => {
  it('pauses every approval-required leaf across branched sessions and leaves other states unchanged', async () => {
    const db = createSqliteDb(':memory:');
    try {
      await sql`
        CREATE TABLE turn (
          session_id TEXT NOT NULL,
          turn_id TEXT NOT NULL,
          previous_turn_id TEXT,
          state BLOB NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (session_id, turn_id)
        ) STRICT
      `.execute(db);
      await sql`
        CREATE TABLE session_event (
          session_id TEXT NOT NULL,
          turn_id TEXT NOT NULL,
          event_id TEXT NOT NULL,
          event BLOB NOT NULL,
          PRIMARY KEY (session_id, turn_id, event_id)
        ) STRICT
      `.execute(db);

      const done = doneState();
      const doneWithApproval = doneState([approvalRequired]);
      await sql`
        INSERT INTO turn (session_id, turn_id, previous_turn_id, state, updated_at)
        VALUES
          ('session-1', 'turn-1', NULL, jsonb(${JSON.stringify(done)}), 'before'),
          ('session-1', 'turn-1-child-1', 'turn-1', jsonb(${JSON.stringify(doneWithApproval)}), 'before'),
          ('session-1', 'turn-1-child-2', 'turn-1', jsonb(${JSON.stringify(done)}), 'before'),
          ('session-2', 'turn-3', NULL, jsonb(${JSON.stringify(doneWithApproval)}), 'before'),
          ('session-3', 'turn-4', NULL, jsonb(${JSON.stringify(errorState)}), 'before')
      `.execute(db);
      await sql`
        INSERT INTO session_event (session_id, turn_id, event_id, event)
        VALUES
          ('session-1', 'turn-1', 'event-1', jsonb(${JSON.stringify(turnDoneEvent('event-1', done))})),
          (
            'session-1',
            'turn-1-child-1',
            'event-2',
            jsonb(${JSON.stringify(turnDoneEvent('event-2', doneWithApproval))})
          ),
          (
            'session-1',
            'turn-1-child-2',
            'event-3',
            jsonb(${JSON.stringify(turnDoneEvent('event-3', done))})
          ),
          (
            'session-2',
            'turn-3',
            'event-4',
            jsonb(${JSON.stringify(turnDoneEvent('event-4', doneWithApproval))})
          ),
          ('session-3', 'turn-4', 'event-5', jsonb(${JSON.stringify(turnDoneEvent('event-5', errorState))}))
      `.execute(db);

      await up(db);

      const turns = await sql<{ session_id: string; turn_id: string; state: unknown }>`
        SELECT session_id, turn_id, json(state) AS state
        FROM turn
      `.execute(db);
      expect(Object.fromEntries(turns.rows.map(turn => [`${turn.session_id}/${turn.turn_id}`, turn.state]))).toEqual({
        'session-1/turn-1': done,
        'session-1/turn-1-child-1': { status: 'paused' },
        'session-1/turn-1-child-2': done,
        'session-2/turn-3': { status: 'paused' },
        'session-3/turn-4': errorState,
      });

      const events = await sql<{ session_id: string; turn_id: string; event: unknown }>`
        SELECT session_id, turn_id, json(event) AS event
        FROM session_event
      `.execute(db);
      expect(Object.fromEntries(events.rows.map(row => [`${row.session_id}/${row.turn_id}`, row.event]))).toEqual({
        'session-1/turn-1': turnDoneEvent('event-1', done),
        'session-1/turn-1-child-1': {
          ...turnDoneEvent('event-2', doneWithApproval),
          type: 'turn.update',
          state: { status: 'paused' },
        },
        'session-1/turn-1-child-2': turnDoneEvent('event-3', done),
        'session-2/turn-3': {
          ...turnDoneEvent('event-4', doneWithApproval),
          type: 'turn.update',
          state: { status: 'paused' },
        },
        'session-3/turn-4': turnDoneEvent('event-5', errorState),
      });
    } finally {
      await db.destroy();
    }
  });
});
