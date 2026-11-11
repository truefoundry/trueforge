import { sql } from 'kysely';

import { createSqliteDb } from '../../../../../src/db/sqlite/client';
import { up } from '../../../../../src/db/sqlite/migrations/20261105_000003_turn_done_approval_to_paused';

const approvalRequired = {
  type: 'tool.approval_required',
  id: 'approval-1',
  thread_id: 'main',
  tool_call_id: 'call-1',
};
const responseRequired = {
  type: 'tool.response_required',
  id: 'response-1',
  thread_id: 'main',
  tool_call_id: 'call-2',
};
const mcpAuthRequired = {
  type: 'mcp.auth_required',
  id: 'auth-1',
  thread_id: null,
  mcp_servers: [],
};

function doneState(requiredActions: object[] = [], metrics?: object) {
  return {
    status: 'done',
    output: null,
    required_actions: requiredActions,
    completed_at: '2026-10-06T00:00:10.000Z',
    ...(metrics === undefined ? {} : { metrics }),
  };
}

function pausedState(metrics?: object) {
  return {
    status: 'paused',
    ...(metrics === undefined ? {} : { metrics }),
  };
}

/** Closed running interval copied onto the checkpoint: completed_at minus created_at. */
const migratedDurationMs = 10_000;

function migratedCheckpoint(metrics: object, extra: object = {}) {
  return {
    ...extra,
    metrics: {
      total_input_tokens: 0,
      total_output_tokens: 0,
      total_tokens: 0,
      ...metrics,
    },
    active_duration_ms: migratedDurationMs,
    running_since: null,
  };
}

const errorState = {
  status: 'error',
  message: 'failed',
  completed_at: '2026-10-06T00:00:10.000Z',
};

function turnDoneEvent(id: string, state: object) {
  return {
    type: 'turn.done',
    id,
    state,
    created_at: '2026-10-06T00:00:10.000Z',
    thread_id: null,
  };
}

describe('SQLite done action-required turn migration', () => {
  it('pauses every action-required leaf across branched sessions and leaves other states unchanged', async () => {
    const db = createSqliteDb(':memory:');
    try {
      await sql`
        CREATE TABLE session (
          session_id TEXT PRIMARY KEY,
          metrics BLOB NOT NULL,
          last_turn_details BLOB
        ) STRICT
      `.execute(db);
      await sql`
        CREATE TABLE turn (
          session_id TEXT NOT NULL,
          turn_id TEXT NOT NULL,
          previous_turn_id TEXT,
          state BLOB NOT NULL,
          checkpoint BLOB NOT NULL,
          created_at TEXT NOT NULL,
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
      const approvalMetrics = {
        total_input_tokens: 11,
        total_output_tokens: 7,
        total_tokens: 18,
        total_reasoning_tokens: 3,
        total_cost_in_usd: 1.25,
      };
      const responseMetrics = { total_cost_in_usd: 0.75 };
      const mcpAuthMetrics = { total_cost_in_usd: 1.5 };
      const doneWithApproval = doneState([approvalRequired], approvalMetrics);
      const doneWithResponse = doneState([responseRequired], responseMetrics);
      const doneWithMcpAuth = doneState([mcpAuthRequired], mcpAuthMetrics);
      const keptCheckpoint = { sandbox_info: { sandbox_id: 'sb-kept' } };
      const tipDetails = (id: string, status: string) => ({ id, state: { status } });
      await sql`
        INSERT INTO session (session_id, metrics, last_turn_details)
        VALUES
          (
            'session-1',
            jsonb('{"total_duration_ms":30000,"total_turns":3,"total_cost_in_usd":2}'),
            jsonb(${JSON.stringify(tipDetails('turn-1-child-2', 'done'))})
          ),
          (
            'session-2',
            jsonb('{"total_duration_ms":10000,"total_turns":1,"total_cost_in_usd":1.5}'),
            jsonb(${JSON.stringify(tipDetails('turn-3', 'done'))})
          ),
          (
            'session-3',
            jsonb('{"total_duration_ms":10000,"total_turns":1}'),
            jsonb(${JSON.stringify(tipDetails('turn-4', 'error'))})
          )
      `.execute(db);
      await sql`
        INSERT INTO turn (session_id, turn_id, previous_turn_id, state, checkpoint, created_at, updated_at)
        VALUES
          (
            'session-1',
            'turn-1',
            NULL,
            jsonb(${JSON.stringify(done)}),
            jsonb(${JSON.stringify(keptCheckpoint)}),
            '2026-10-06T00:00:00.000Z',
            'before'
          ),
          (
            'session-1',
            'turn-1-child-1',
            'turn-1',
            jsonb(${JSON.stringify(doneWithApproval)}),
            jsonb('{}'),
            '2026-10-06T00:00:00.000Z',
            'before'
          ),
          (
            'session-1',
            'turn-1-child-2',
            'turn-1',
            jsonb(${JSON.stringify(doneWithResponse)}),
            jsonb('{}'),
            '2026-10-06T00:00:00.000Z',
            'before'
          ),
          (
            'session-2',
            'turn-3',
            NULL,
            jsonb(${JSON.stringify(doneWithMcpAuth)}),
            jsonb(${JSON.stringify(keptCheckpoint)}),
            '2026-10-06T00:00:00.000Z',
            'before'
          ),
          (
            'session-3',
            'turn-4',
            NULL,
            jsonb(${JSON.stringify(errorState)}),
            jsonb('{}'),
            '2026-10-06T00:00:00.000Z',
            'before'
          )
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
            jsonb(${JSON.stringify(turnDoneEvent('event-3', doneWithResponse))})
          ),
          (
            'session-2',
            'turn-3',
            'event-4',
            jsonb(${JSON.stringify(turnDoneEvent('event-4', doneWithMcpAuth))})
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
        'session-1/turn-1-child-1': pausedState(approvalMetrics),
        'session-1/turn-1-child-2': pausedState(responseMetrics),
        'session-2/turn-3': pausedState(mcpAuthMetrics),
        'session-3/turn-4': errorState,
      });

      const checkpoints = await sql<{ session_id: string; turn_id: string; checkpoint: unknown }>`
        SELECT session_id, turn_id, json(checkpoint) AS checkpoint
        FROM turn
      `.execute(db);
      expect(
        Object.fromEntries(checkpoints.rows.map(turn => [`${turn.session_id}/${turn.turn_id}`, turn.checkpoint])),
      ).toEqual({
        'session-1/turn-1': keptCheckpoint,
        'session-1/turn-1-child-1': migratedCheckpoint(approvalMetrics),
        'session-1/turn-1-child-2': migratedCheckpoint(responseMetrics),
        'session-2/turn-3': migratedCheckpoint(mcpAuthMetrics, keptCheckpoint),
        'session-3/turn-4': {},
      });

      const sessions = await sql<{ session_id: string; metrics: unknown; last_turn_details: unknown }>`
        SELECT session_id, json(metrics) AS metrics, json(last_turn_details) AS last_turn_details
        FROM session
      `.execute(db);
      expect(Object.fromEntries(sessions.rows.map(session => [session.session_id, session.metrics]))).toEqual({
        'session-1': { total_duration_ms: 30_000, total_turns: 3, total_cost_in_usd: 2 },
        'session-2': { total_duration_ms: 10_000, total_turns: 1, total_cost_in_usd: 1.5 },
        'session-3': { total_duration_ms: 10_000, total_turns: 1 },
      });
      expect(Object.fromEntries(sessions.rows.map(session => [session.session_id, session.last_turn_details]))).toEqual(
        {
          'session-1': tipDetails('turn-1-child-2', 'paused'),
          'session-2': tipDetails('turn-3', 'paused'),
          'session-3': tipDetails('turn-4', 'error'),
        },
      );

      const events = await sql<{ session_id: string; turn_id: string; event: unknown }>`
        SELECT session_id, turn_id, json(event) AS event
        FROM session_event
      `.execute(db);
      expect(Object.fromEntries(events.rows.map(row => [`${row.session_id}/${row.turn_id}`, row.event]))).toEqual({
        'session-1/turn-1': turnDoneEvent('event-1', done),
        'session-1/turn-1-child-1': {
          ...turnDoneEvent('event-2', doneWithApproval),
          type: 'turn.update',
          state: pausedState(approvalMetrics),
        },
        'session-1/turn-1-child-2': {
          ...turnDoneEvent('event-3', doneWithResponse),
          type: 'turn.update',
          state: pausedState(responseMetrics),
        },
        'session-2/turn-3': {
          ...turnDoneEvent('event-4', doneWithMcpAuth),
          type: 'turn.update',
          state: pausedState(mcpAuthMetrics),
        },
        'session-3/turn-4': turnDoneEvent('event-5', errorState),
      });
    } finally {
      await db.destroy();
    }
  });
});
