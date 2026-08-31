/**
 * Postgres historical session snapshot insert (skip-if-exists).
 */
import type { Kysely } from 'kysely';
import type { ImportSessionSnapshotRequest, ImportSessionSnapshotResult } from '../../../schemas/sessionImport';
import { isContextPrefix, type ISessionSnapshotImporter } from '../../sessionSnapshotImport';
import { json, jsonUnknown } from '../sqlExpressions';
import type { Database } from '../types';

export class PostgresSessionSnapshotImporter implements ISessionSnapshotImporter {
  constructor(private readonly db: Kysely<Database>) {}

  async importSessionSnapshot(input: ImportSessionSnapshotRequest): Promise<ImportSessionSnapshotResult> {
    const sessionId = input.session.session_id;
    return this.db.transaction().execute(async trx => {
      const { session, turns } = input;
      const insertedSession = await trx
        .insertInto('session')
        .values({
          tenant_id: session.tenant_id,
          session_id: sessionId,
          created_by: session.created_by,
          agent_id: null,
          agent_name: null,
          agent_spec: jsonUnknown(session.agent_spec),
          title: session.title,
          last_turn_id: session.last_turn_id,
          custom: session.custom !== null ? json(session.custom) : null,
          last_activity_timestamp_ms: session.last_activity_timestamp_ms,
          created_at: new Date(session.created_at),
          updated_at: new Date(session.updated_at),
        })
        .onConflict(oc => oc.column('session_id').doNothing())
        .returning('session_id')
        .executeTakeFirst();
      if (insertedSession === undefined) {
        return { imported: false, session_id: sessionId };
      }

      const prevContextByThread = new Map<string, unknown[]>();
      const prevContextIdsByThread = new Map<string, number[]>();

      for (const turn of turns) {
        await trx
          .insertInto('turn')
          .values({
            session_id: sessionId,
            turn_id: turn.turn_id,
            first_turn_id: turn.first_turn_id,
            previous_turn_id: turn.previous_turn_id,
            ancestor_ids: turn.ancestor_ids,
            input: jsonUnknown(turn.input),
            state: jsonUnknown(turn.state),
            checkpoint: jsonUnknown(turn.checkpoint),
            custom: turn.custom !== null ? json(turn.custom) : null,
            created_at: new Date(turn.created_at),
            updated_at: new Date(turn.updated_at),
          })
          .execute();

        for (const thread of turn.threads) {
          const prevCtx = prevContextByThread.get(thread.thread_id) ?? [];
          const prevIds = prevContextIdsByThread.get(thread.thread_id) ?? [];
          const appendOnly = isContextPrefix({ prefix: prevCtx, full: thread.context });
          const newMessages = appendOnly ? thread.context.slice(prevCtx.length) : thread.context;
          const reusedIds = appendOnly ? prevIds : [];

          const newIds: number[] = [];
          if (newMessages.length > 0) {
            const inserted = await trx
              .insertInto('thread_context_log')
              .values(
                newMessages.map(msg => ({
                  session_id: sessionId,
                  thread_id: thread.thread_id,
                  turn_id: turn.turn_id,
                  body: jsonUnknown(msg),
                  created_at: new Date(turn.updated_at),
                })),
              )
              .returning(['append_id'])
              .execute();
            for (const row of inserted) {
              newIds.push(row.append_id);
            }
          }

          const contextIds = [...reusedIds, ...newIds];
          await trx
            .insertInto('turn_thread')
            .values({
              session_id: sessionId,
              turn_id: turn.turn_id,
              thread_id: thread.thread_id,
              checkpoint: jsonUnknown({ parent: thread.parent, completion: thread.completion }),
              agent_info: thread.agent_info !== null ? jsonUnknown(thread.agent_info) : null,
              current_context_usage: jsonUnknown(thread.current_context_usage),
              context_ids: contextIds,
              updated_at: new Date(turn.updated_at),
            })
            .execute();

          prevContextByThread.set(thread.thread_id, thread.context);
          prevContextIdsByThread.set(thread.thread_id, contextIds);

          if (thread.capability_state !== null) {
            const capEntries = Object.entries(thread.capability_state);
            if (capEntries.length > 0) {
              await trx
                .insertInto('thread_capability_state')
                .values(
                  capEntries.map(([key, state]) => ({
                    session_id: sessionId,
                    turn_id: turn.turn_id,
                    thread_id: thread.thread_id,
                    key,
                    state: jsonUnknown(state),
                    updated_at: new Date(turn.updated_at),
                  })),
                )
                .execute();
            }
          }
        }

        if (turn.events.length > 0) {
          await trx
            .insertInto('session_event')
            .values(
              turn.events.map(event => ({
                session_id: sessionId,
                turn_id: turn.turn_id,
                event_id: event.id,
                event: jsonUnknown(event),
                created_at: new Date(event.created_at),
              })),
            )
            .execute();
        }
      }

      return { imported: true, session_id: sessionId };
    });
  }
}
