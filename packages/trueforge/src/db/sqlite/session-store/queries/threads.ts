import type {
  AddThreadsInput,
  AppendToThreadContextInput,
  OverwriteThreadContextInput,
  PatchMCPServersInput,
  PatchSandboxInfoInput,
  RemoveThreadsInput,
} from '@truefoundry/trueforge-core/agent-session/store/ISessionStore';
import type {
  ContextMessage,
  SubAgentCompletionMarker,
} from '@truefoundry/trueforge-core/core/runtime/AgentThread.types';
import type { CurrentContextUsage } from '@truefoundry/trueforge-core/core/runtime/contextUsage';
import { sql, type Kysely, type RawBuilder, type Transaction } from 'kysely';
import { jsonbBind, jsonbSet, nowIso } from '../../sqlExpressions';
import type { Database, TurnThreadCheckpoint } from '../../types';
import { sortedByAppendId } from '../sqlExpressions';
import {
  assertTurnRunning,
  classifyTurnFenceWriteFailure,
  classifyTurnThreadWriteFailure,
  type TurnKeys,
} from './turns';

type DbOrTrx = Kysely<Database> | Transaction<Database>;

/**
 * addThreads — fenced tx: INSERT log rows, INSERT turn_thread rows,
 * INSERT turn_thread_context rows, INSERT capability rows.
 */
export async function addThreads(db: Kysely<Database>, input: AddThreadsInput): Promise<void> {
  await db.transaction().execute(async trx => {
    await assertTurnRunning(trx, {
      session_id: input.session_id,
      turn_id: input.turn_id,
    });

    const now = nowIso();
    const logRows: {
      session_id: string;
      thread_id: string;
      turn_id: string;
      body: RawBuilder<string>;
      created_at: string;
    }[] = [];
    const capabilityStateRows: {
      session_id: string;
      turn_id: string;
      thread_id: string;
      key: string;
      state: RawBuilder<string> | null;
      updated_at: string;
    }[] = [];
    const turnThreadPlans: {
      thread_id: string;
      checkpoint: TurnThreadCheckpoint;
      agent_info: RawBuilder<string> | null;
      current_context_usage: CurrentContextUsage;
    }[] = [];

    for (const thread of input.threads) {
      const threadCheckpoint: TurnThreadCheckpoint = {
        parent: thread.parent ?? null,
        completion: thread.completion ?? null,
      };
      turnThreadPlans.push({
        thread_id: thread.thread_id,
        checkpoint: threadCheckpoint,
        agent_info: thread.agent_info != null ? jsonbBind(thread.agent_info) : null,
        current_context_usage: thread.current_context_usage,
      });

      for (const body of thread.context) {
        logRows.push({
          session_id: input.session_id,
          thread_id: thread.thread_id,
          turn_id: input.turn_id,
          body: jsonbBind(body),
          created_at: now,
        });
      }

      const capabilityState = thread.capability_state;
      if (capabilityState != null) {
        for (const key of Object.keys(capabilityState)) {
          const state = capabilityState[key];
          if (state === undefined) {
            throw new Error(
              `capability_state['${key}'] for thread '${thread.thread_id}' is undefined — undefined is banned from capability state`,
            );
          }
          capabilityStateRows.push({
            session_id: input.session_id,
            turn_id: input.turn_id,
            thread_id: thread.thread_id,
            key,
            state: state !== null ? jsonbBind(state) : null,
            updated_at: now,
          });
        }
      }
    }

    const newIdsByThread = new Map<string, number[]>();
    if (logRows.length > 0) {
      const inserted = await trx
        .insertInto('thread_context_log')
        .values(logRows)
        .returning(['thread_id', 'append_id'])
        .execute();
      for (const row of sortedByAppendId(inserted)) {
        const list = newIdsByThread.get(row.thread_id);
        if (list === undefined) {
          newIdsByThread.set(row.thread_id, [row.append_id]);
        } else {
          list.push(row.append_id);
        }
      }
    }

    const turnThreadRows = turnThreadPlans.map(plan => ({
      session_id: input.session_id,
      turn_id: input.turn_id,
      thread_id: plan.thread_id,
      checkpoint: jsonbBind(plan.checkpoint),
      agent_info: plan.agent_info,
      current_context_usage: jsonbBind(plan.current_context_usage),
      updated_at: now,
    }));

    if (turnThreadRows.length > 0) {
      await trx.insertInto('turn_thread').values(turnThreadRows).execute();
    }

    const contextMappingRows: {
      session_id: string;
      turn_id: string;
      thread_id: string;
      pos: number;
      append_id: number;
    }[] = [];

    for (const plan of turnThreadPlans) {
      const newIds = newIdsByThread.get(plan.thread_id) ?? [];
      for (let i = 0; i < newIds.length; i++) {
        const appendId = newIds[i];
        if (appendId !== undefined) {
          contextMappingRows.push({
            session_id: input.session_id,
            turn_id: input.turn_id,
            thread_id: plan.thread_id,
            pos: i + 1,
            append_id: appendId,
          });
        }
      }
    }

    if (contextMappingRows.length > 0) {
      await trx.insertInto('turn_thread_context').values(contextMappingRows).execute();
    }

    if (capabilityStateRows.length > 0) {
      await trx.insertInto('thread_capability_state').values(capabilityStateRows).execute();
    }
  });
}

/**
 * removeThreads — fenced tx: DELETE this turn's turn_thread rows,
 * turn_thread_context rows, and capability rows.
 * Older turns keep their per-turn maps. Log rows stay (other turns may reference them).
 * Empty thread_ids is a no-op.
 */
export async function removeThreads(db: Kysely<Database>, input: RemoveThreadsInput): Promise<void> {
  if (input.thread_ids.length === 0) {
    return;
  }

  await db.transaction().execute(async trx => {
    await assertTurnRunning(trx, {
      session_id: input.session_id,
      turn_id: input.turn_id,
    });

    await trx
      .deleteFrom('turn_thread_context')
      .where('session_id', '=', input.session_id)
      .where('turn_id', '=', input.turn_id)
      .where('thread_id', 'in', input.thread_ids)
      .execute();

    await trx
      .deleteFrom('turn_thread')
      .where('session_id', '=', input.session_id)
      .where('turn_id', '=', input.turn_id)
      .where('thread_id', 'in', input.thread_ids)
      .execute();

    await trx
      .deleteFrom('thread_capability_state')
      .where('session_id', '=', input.session_id)
      .where('turn_id', '=', input.turn_id)
      .where('thread_id', 'in', input.thread_ids)
      .execute();
  });
}

async function getNextPos(db: DbOrTrx, keys: TurnKeys, thread_id: string): Promise<number> {
  const maxRow = await db
    .selectFrom('turn_thread_context')
    .select([sql<number | null>`MAX(pos)`.as('max_pos')])
    .where('session_id', '=', keys.session_id)
    .where('turn_id', '=', keys.turn_id)
    .where('thread_id', '=', thread_id)
    .executeTakeFirst();
  return (maxRow?.max_pos ?? 0) + 1;
}

function completionPatchExpr(completion: SubAgentCompletionMarker | null): RawBuilder<string> {
  if (completion === null) {
    return sql`checkpoint`;
  }
  return jsonbSet(sql.ref('checkpoint'), '$.completion', completion);
}

function usageSetExpr(usage: CurrentContextUsage | null): RawBuilder<string> {
  if (usage === null) {
    return sql`current_context_usage`;
  }
  return sql`coalesce(${jsonbBind(usage)}, current_context_usage)`;
}

async function fencedTurnThreadContextUpdate(
  db: Kysely<Database>,
  args: {
    keys: TurnKeys;
    thread_id: string;
    context: ContextMessage[];
    replace_array: boolean;
    current_context_usage: CurrentContextUsage | null;
    completion: SubAgentCompletionMarker | null;
    /** When replace_array, usage is set unconditionally (overwrite contract). */
    usage_unconditional: CurrentContextUsage | null;
  },
): Promise<void> {
  const { keys, thread_id, context, replace_array } = args;

  await db.transaction().execute(async trx => {
    await assertTurnRunning(trx, keys);

    const now = nowIso();

    if (replace_array) {
      await trx
        .deleteFrom('turn_thread_context')
        .where('session_id', '=', keys.session_id)
        .where('turn_id', '=', keys.turn_id)
        .where('thread_id', '=', thread_id)
        .execute();
    }

    if (context.length > 0) {
      const logRows = context.map(body => ({
        session_id: keys.session_id,
        thread_id,
        turn_id: keys.turn_id,
        body: jsonbBind(body),
        created_at: now,
      }));

      const inserted = await trx.insertInto('thread_context_log').values(logRows).returning(['append_id']).execute();

      let nextPos = replace_array ? 1 : await getNextPos(trx, keys, thread_id);

      const contextMappingRows: {
        session_id: string;
        turn_id: string;
        thread_id: string;
        pos: number;
        append_id: number;
      }[] = [];

      for (const row of sortedByAppendId(inserted)) {
        contextMappingRows.push({
          session_id: keys.session_id,
          turn_id: keys.turn_id,
          thread_id,
          pos: nextPos,
          append_id: row.append_id,
        });
        nextPos++;
      }

      if (contextMappingRows.length > 0) {
        await trx.insertInto('turn_thread_context').values(contextMappingRows).execute();
      }
    }

    const usageExpr =
      args.usage_unconditional !== null
        ? jsonbBind(args.usage_unconditional)
        : usageSetExpr(args.current_context_usage);

    const updateResult = await trx
      .updateTable('turn_thread')
      .set({
        checkpoint: completionPatchExpr(args.completion),
        current_context_usage: usageExpr,
        updated_at: now,
      })
      .where('session_id', '=', keys.session_id)
      .where('turn_id', '=', keys.turn_id)
      .where('thread_id', '=', thread_id)
      .executeTakeFirst();

    if (Number(updateResult.numUpdatedRows) === 0) {
      await classifyTurnThreadWriteFailure(trx, keys, thread_id);
    }
  });
}

/**
 * appendToThreadContext — fenced transaction: inserts log rows, appends mapping rows,
 * updates usage (COALESCE: provided wins, else keep), patches completion.
 */
export async function appendToThreadContext(db: Kysely<Database>, input: AppendToThreadContextInput): Promise<void> {
  await fencedTurnThreadContextUpdate(db, {
    keys: {
      session_id: input.session_id,
      turn_id: input.turn_id,
    },
    thread_id: input.thread_id,
    context: input.context,
    replace_array: false,
    current_context_usage: input.current_context_usage,
    completion: input.completion,
    usage_unconditional: null,
  });
}

/**
 * overwriteThreadContext — same fenced shape; context mapping is REPLACED.
 * Old log rows stay — ancestor turns' context mapping may reference them.
 */
export async function overwriteThreadContext(db: Kysely<Database>, input: OverwriteThreadContextInput): Promise<void> {
  await fencedTurnThreadContextUpdate(db, {
    keys: {
      session_id: input.session_id,
      turn_id: input.turn_id,
    },
    thread_id: input.event.thread_id,
    context: input.event.context,
    replace_array: true,
    current_context_usage: null,
    completion: null,
    usage_unconditional: input.event.current_context_usage,
  });
}

/**
 * patchMCPServers — conditional UPDATE fenced on state->>'status'='running'.
 * Shallow merge by server id (Postgres `||`): patched ids replace wholesale.
 */
export async function patchMCPServers(db: Kysely<Database>, input: PatchMCPServersInput): Promise<void> {
  const serversById: Record<string, (typeof input.mcp_servers)[number]> = {};
  for (const server of input.mcp_servers) {
    serversById[server.id] = server;
  }

  const keys: TurnKeys = {
    session_id: input.session_id,
    turn_id: input.turn_id,
  };

  // jsonb_patch is RFC 7396 (deep); rebuild via json_each so each id's value is replaced.
  const patchJson = JSON.stringify(serversById);

  const result = await db
    .updateTable('turn')
    .set({
      checkpoint: sql<string>`jsonb_set(
        checkpoint,
        '$.mcp_servers',
        coalesce((
          SELECT jsonb_group_object(key, jsonb(value))
          FROM (
            SELECT key, value
            FROM json_each(
              CASE WHEN json_type(checkpoint, '$.mcp_servers') = 'object'
                   THEN json(jsonb_extract(checkpoint, '$.mcp_servers'))
                   ELSE '{}' END
            )
            WHERE key NOT IN (SELECT key FROM json_each(${patchJson}))
            UNION ALL
            SELECT key, value FROM json_each(${patchJson})
          )
        ), jsonb('{}'))
      )`,
      updated_at: nowIso(),
    })
    .where('session_id', '=', keys.session_id)
    .where('turn_id', '=', keys.turn_id)
    .where(sql<boolean>`state->>'status' = 'running'`)
    .executeTakeFirst();

  if (Number(result.numUpdatedRows) === 0) {
    await classifyTurnFenceWriteFailure(db, keys);
  }
}

/**
 * patchSandboxInfo — LWW replace via jsonb_set on sandbox_info key.
 */
export async function patchSandboxInfo(db: Kysely<Database>, input: PatchSandboxInfoInput): Promise<void> {
  const keys: TurnKeys = {
    session_id: input.session_id,
    turn_id: input.turn_id,
  };

  const result = await db
    .updateTable('turn')
    .set({
      checkpoint: jsonbSet(sql.ref('checkpoint'), '$.sandbox_info', input.sandbox_info),
      updated_at: nowIso(),
    })
    .where('session_id', '=', keys.session_id)
    .where('turn_id', '=', keys.turn_id)
    .where(sql<boolean>`state->>'status' = 'running'`)
    .executeTakeFirst();

  if (Number(result.numUpdatedRows) === 0) {
    await classifyTurnFenceWriteFailure(db, keys);
  }
}
