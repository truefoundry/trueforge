import type {
  AddThreadsInput,
  AppendToThreadContextInput,
  OverwriteThreadContextInput,
  PatchMCPServersInput,
  PatchSandboxInfoInput,
  RemoveThreadsInput,
} from '@truefoundry/trueforge-core/agent-session/store/ISessionStore';
import type { JsonValue } from '@truefoundry/trueforge-core/core/capabilities/AgentCapability';
import type { AgentInfo } from '@truefoundry/trueforge-core/core/events/schema';
import type {
  ContextMessage,
  SubAgentCompletionMarker,
} from '@truefoundry/trueforge-core/core/runtime/AgentThread.types';
import type { CurrentContextUsage } from '@truefoundry/trueforge-core/core/runtime/contextUsage';
import { sql, type Kysely, type RawBuilder, type Transaction } from 'kysely';
import { json, jsonbSet } from '../../sqlExpressions';
import type { Database, TurnThreadCheckpoint } from '../../types';
import { values } from '../sqlExpressions';
import {
  assertTurnRunning,
  classifyTurnFenceWriteFailure,
  classifyTurnThreadWriteFailure,
  turnRunningFence,
  type TurnKeys,
} from './turns';

type DbOrTrx = Kysely<Database> | Transaction<Database>;

interface CapabilityStateInsertRow {
  session_id: string;
  turn_id: string;
  thread_id: string;
  key: string;
  state: RawBuilder<JsonValue>;
  updated_at: RawBuilder<Date>;
}

/**
 * addThreads — fenced tx, max 3 batched statements: log INSERT, turn_thread INSERT,
 * capability upsert. No turn.checkpoint touch (threads live in turn_thread).
 */
export async function addThreads(db: Kysely<Database>, input: AddThreadsInput): Promise<void> {
  await db.transaction().execute(async trx => {
    await assertTurnRunning(trx, {
      session_id: input.session_id,
      turn_id: input.turn_id,
    });

    const now = new Date();
    const logRows: {
      session_id: string;
      thread_id: string;
      turn_id: string;
      body: RawBuilder<ContextMessage>;
      created_at: Date;
    }[] = [];
    const capabilityStateRows: CapabilityStateInsertRow[] = [];
    const turnThreadPlans: {
      thread_id: string;
      checkpoint: TurnThreadCheckpoint;
      agent_info: RawBuilder<AgentInfo> | null;
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
        agent_info: thread.agent_info != null ? json(thread.agent_info) : null,
        current_context_usage: thread.current_context_usage,
      });

      for (const body of thread.context) {
        logRows.push({
          session_id: input.session_id,
          thread_id: thread.thread_id,
          turn_id: input.turn_id,
          body: json(body),
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
            state: json(state),
            updated_at: sql<Date>`now()`,
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
      for (const row of inserted) {
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
      checkpoint: plan.checkpoint,
      agent_info: plan.agent_info,
      current_context_usage: plan.current_context_usage,
      context_ids: newIdsByThread.get(plan.thread_id) ?? [],
      updated_at: now,
    }));

    if (turnThreadRows.length > 0) {
      await trx.insertInto('turn_thread').values(turnThreadRows).execute();
    }

    if (capabilityStateRows.length > 0) {
      await trx.insertInto('thread_capability_state').values(capabilityStateRows).execute();
    }
  });
}

/**
 * removeThreads — one statement: fence FOR SHARE + delete turn_thread + capability rows.
 * Older turns keep their maps; log rows stay. Empty thread_ids is a no-op.
 */
export async function removeThreads(db: Kysely<Database>, input: RemoveThreadsInput): Promise<void> {
  if (input.thread_ids.length === 0) {
    return;
  }

  const keys: TurnKeys = {
    session_id: input.session_id,
    turn_id: input.turn_id,
  };
  const onFence = sql<boolean>`EXISTS (SELECT 1 FROM turn_fence)`;

  const fence = await db
    .with('turn_fence', qb => turnRunningFence(qb, keys))
    .with('del_cap', qb =>
      qb
        .deleteFrom('thread_capability_state')
        .where('session_id', '=', keys.session_id)
        .where('turn_id', '=', keys.turn_id)
        .where('thread_id', 'in', input.thread_ids)
        .where(onFence),
    )
    .with('del_tt', qb =>
      qb
        .deleteFrom('turn_thread')
        .where('session_id', '=', keys.session_id)
        .where('turn_id', '=', keys.turn_id)
        .where('thread_id', 'in', input.thread_ids)
        .where(onFence),
    )
    .selectFrom('turn_fence')
    .select('one')
    .executeTakeFirst();

  if (fence === undefined) {
    await classifyTurnFenceWriteFailure(db, keys);
  }
}

function completionPatchExpr(completion: SubAgentCompletionMarker | null): RawBuilder<TurnThreadCheckpoint> {
  if (completion === null) {
    return sql<TurnThreadCheckpoint>`checkpoint`;
  }
  return jsonbSet<TurnThreadCheckpoint>(sql`checkpoint`, sql`'{completion}'`, json(completion));
}

function usageSetExpr(usage: CurrentContextUsage | null): RawBuilder<CurrentContextUsage> {
  if (usage === null) {
    return sql`current_context_usage`;
  }
  // COALESCE matches the plan sketch: provided usage wins, else keep column.
  return sql`coalesce(${json(usage)}, current_context_usage)`;
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

  if (context.length === 0) {
    // No log INSERT — still fence + patch usage/completion / clear-or-keep array.
    const emptyResult = await db
      .with('turn_fence', qb => turnRunningFence(qb, keys))
      .updateTable('turn_thread')
      .set({
        context_ids: replace_array ? sql<number[]>`'{}'::bigint[]` : sql<number[]>`context_ids`,
        current_context_usage: args.usage_unconditional ?? usageSetExpr(args.current_context_usage),
        checkpoint: completionPatchExpr(args.completion),
        updated_at: sql`now()`,
      })
      .where('session_id', '=', keys.session_id)
      .where('turn_id', '=', keys.turn_id)
      .where('thread_id', '=', thread_id)
      .where(sql<boolean>`EXISTS (SELECT 1 FROM turn_fence)`)
      .executeTakeFirst();

    if (Number(emptyResult.numUpdatedRows) === 0) {
      await classifyTurnThreadWriteFailure(db, keys, thread_id);
    }
    return;
  }

  const bodyRows = context.map((body, index) => ({
    ord: sql<number>`${index + 1}::int`,
    body: json(body),
  }));

  const arrayExpr: RawBuilder<number[]> = replace_array
    ? sql<number[]>`coalesce((SELECT array_agg(append_id ORDER BY append_id) FROM new_rows), '{}'::bigint[])`
    : sql<
        number[]
      >`context_ids || coalesce((SELECT array_agg(append_id ORDER BY append_id) FROM new_rows), '{}'::bigint[])`;

  const result = await db
    .with('turn_fence', qb => turnRunningFence(qb, keys))
    .with('new_rows', qb =>
      qb
        .insertInto('thread_context_log')
        .columns(['session_id', 'thread_id', 'turn_id', 'body', 'created_at'])
        .expression(eb =>
          eb
            .selectFrom(values(bodyRows, 'b'))
            .select([
              sql<string>`${keys.session_id}`.as('session_id'),
              sql<string>`${thread_id}`.as('thread_id'),
              sql<string>`${keys.turn_id}`.as('turn_id'),
              'b.body',
              sql<Date>`now()`.as('created_at'),
            ])
            .where(wb => wb.exists(wb.selectFrom('turn_fence').select(sql`1`.as('one'))))
            .orderBy('b.ord'),
        )
        .returning('append_id'),
    )
    .updateTable('turn_thread')
    .set({
      context_ids: arrayExpr,
      current_context_usage: args.usage_unconditional ?? usageSetExpr(args.current_context_usage),
      checkpoint: completionPatchExpr(args.completion),
      updated_at: sql`now()`,
    })
    .where('session_id', '=', keys.session_id)
    .where('turn_id', '=', keys.turn_id)
    .where('thread_id', '=', thread_id)
    .where(sql<boolean>`EXISTS (SELECT 1 FROM turn_fence)`)
    .executeTakeFirst();

  if (Number(result.numUpdatedRows) === 0) {
    await classifyTurnThreadWriteFailure(db, keys, thread_id);
  }
}

/**
 * appendToThreadContext — ONE fenced statement: CTE inserts log rows, outer UPDATE
 * concats their ids, stamps usage (COALESCE), and patches completion on the same
 * turn_thread row version.
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
 * overwriteThreadContext — same one-statement shape; context_ids is REPLACED.
 * Old log rows stay — ancestor turns' arrays reference them. No lineage minting.
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
 * patchMCPServers — one-shot conditional UPDATE on the fence row itself
 * (`state->>'status' = 'running'`). No separate FOR SHARE fence CTE.
 * Subscript LHS + expression RHS for shallow merge by server id.
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

  const result = await db
    .updateTable('turn')
    .set(
      sql`checkpoint['mcp_servers']`,
      sql`(CASE WHEN jsonb_typeof(checkpoint->'mcp_servers') = 'object'
            THEN checkpoint->'mcp_servers'
            ELSE '{}'::jsonb END) || ${json(serversById)}`,
    )
    .set({ updated_at: sql`now()` })
    .where('session_id', '=', keys.session_id)
    .where('turn_id', '=', keys.turn_id)
    .where(sql<boolean>`state->>'status' = 'running'`)
    .executeTakeFirst();

  if (Number(result.numUpdatedRows) === 0) {
    await classifyTurnFenceWriteFailure(db, keys);
  }
}

/**
 * patchSandboxInfo — one-shot conditional UPDATE on the fence row itself
 * (`state->>'status' = 'running'`). LWW replace via subscript assignment.
 */
export async function patchSandboxInfo(db: Kysely<Database>, input: PatchSandboxInfoInput): Promise<void> {
  const keys: TurnKeys = {
    session_id: input.session_id,
    turn_id: input.turn_id,
  };

  const result = await db
    .updateTable('turn')
    .set(sql`checkpoint['sandbox_info']`, json(input.sandbox_info))
    .set({ updated_at: sql`now()` })
    .where('session_id', '=', keys.session_id)
    .where('turn_id', '=', keys.turn_id)
    .where(sql<boolean>`state->>'status' = 'running'`)
    .executeTakeFirst();

  if (Number(result.numUpdatedRows) === 0) {
    await classifyTurnFenceWriteFailure(db, keys);
  }
}

/** Test helper: read a turn_thread row. */
export async function getTurnThread(
  db: DbOrTrx,
  session_id: string,
  turn_id: string,
  thread_id: string,
): Promise<
  | {
      thread_id: string;
      checkpoint: TurnThreadCheckpoint;
      agent_info: unknown;
      current_context_usage: CurrentContextUsage;
      context_ids: number[];
    }
  | undefined
> {
  return await db
    .selectFrom('turn_thread')
    .select(['thread_id', 'checkpoint', 'agent_info', 'current_context_usage', 'context_ids'])
    .where('session_id', '=', session_id)
    .where('turn_id', '=', turn_id)
    .where('thread_id', '=', thread_id)
    .executeTakeFirst();
}
