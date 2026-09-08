import type { SessionRecord } from '@truefoundry/trueforge-core/agent-session/models/SessionRecord';
import type { TurnRecord } from '@truefoundry/trueforge-core/agent-session/models/TurnRecord';
import type { PersistedTurnEvent, SessionEventItem } from '@truefoundry/trueforge-core/agent-session/schemas/events';
import type { TokenPagination } from '@truefoundry/trueforge-core/agent-session/schemas/pagination';
import type {
  AddThreadsInput,
  AppendToEventsInput,
  AppendToThreadContextInput,
  CreateSessionInput,
  CreateTurnInput,
  DeleteSessionInput,
  FreezeAndGetTurnInput,
  GetOwnedIdsInput,
  GetSessionByExternalIdInput,
  GetSessionInput,
  GetTurnInput,
  ISessionStore,
  ListSessionEventsInput,
  ListSessionsInput,
  ListTurnEventsInput,
  ListTurnsInput,
  OverwriteThreadContextInput,
  PatchMCPServersInput,
  PatchSandboxInfoInput,
  PatchThreadCapabilityStateInput,
  RemoveThreadsInput,
  TurnRecordWithoutSnapshot,
  UpdateSessionInput,
  UpdateTurnStateInput,
} from '@truefoundry/trueforge-core/agent-session/store/ISessionStore';
import {
  decodeOffsetPageToken,
  encodeOffsetPageToken,
} from '@truefoundry/trueforge-core/agent-session/store/OffsetPageToken';
import type { AgentSpec, TurnInputItem, TurnState } from '@truefoundry/trueforge-core/agent-session';
import type { AgentInfo, ContextMessage, JsonValue } from '@truefoundry/trueforge-core/core';
import type { CurrentContextUsage } from '@truefoundry/trueforge-core/core/runtime/contextUsage';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { ImportSessionRequest } from '../../../schemas/agentImport';
import { json, jsonUnknown } from '../sqlExpressions';
import type { Database, TurnCheckpoint, TurnThreadCheckpoint } from '../types';
import { patchThreadCapabilityState as patchThreadCapabilityStateQuery } from './queries/capabilities';
import {
  appendToEvents as appendToEventsQuery,
  listSessionEvents as listSessionEventsQuery,
  listTurnEvents as listTurnEventsQuery,
} from './queries/events';
import {
  createSession as createSessionQuery,
  deleteSession as deleteSessionQuery,
  getOwnedIds as getOwnedIdsQuery,
  getSessionByExternalId as getSessionByExternalIdQuery,
  getSession as getSessionQuery,
  listSessions as listSessionsQuery,
  updateSession as updateSessionQuery,
} from './queries/sessions';
import {
  addThreads as addThreadsQuery,
  appendToThreadContext as appendToThreadContextQuery,
  overwriteThreadContext as overwriteThreadContextQuery,
  patchMCPServers as patchMCPServersQuery,
  patchSandboxInfo as patchSandboxInfoQuery,
  removeThreads as removeThreadsQuery,
} from './queries/threads';
import type { NewThreadRegistration } from './queries/turns';
import {
  createTurn as createTurnQuery,
  freezeAndGetTurn as freezeAndGetTurnQuery,
  getTurn as getTurnQuery,
  listTurns as listTurnsQuery,
  updateTurnState as updateTurnStateQuery,
} from './queries/turns';

type SessionCustom = Record<string, never>;
type TurnCustom = Record<string, never>;

/**
 * ## Design: append-only context log + per-turn id arrays
 *
 * Message bodies live in `thread_context_log`, append-only, written exactly
 * once; ids are store-assigned (`append_id` identity — the delta createTurn
 * interface tells the store what's new, so identity needs no hashing).
 * A turn's context per thread is `turn_thread.context_ids` — the explicit
 * ordered array of log ids. Turns share no mutable structure: linear
 * continuation and fork are the same pointer-copy (`parent_array || new_ids`),
 * overwrite replaces the array, and a still-running ancestor's late appends
 * touch only its OWN rows — structural leaks are impossible by construction.
 *
 * Hard invariants (violations proven by failing tests during prototyping —
 * see the freeze/fence tests):
 * 1. A turn cannot be used as `previous_turn_id` while it is still `running` —
 *    `createTurn` rejects that with PreviousTurnRunningError; callers must
 *    `freezeAndGetTurn` first (barge-in IS cancellation of that predecessor).
 *    Tip-equality is NOT required: new roots and concurrent forks from a
 *    finished tip can leave more than one turn `running` at once.
 * 2. Every turn-scoped write is fenced on `state->>'status' = 'running'`.
 * 3. Terminal turns are IMMUTABLE — a terminal read is a final read.
 */
export class PostgresSessionStore implements ISessionStore<SessionCustom, TurnCustom> {
  constructor(private readonly db: Kysely<Database>) {}

  createSession(input: CreateSessionInput<SessionCustom>): Promise<void> {
    return createSessionQuery(this.db, input);
  }

  deleteSession(input: DeleteSessionInput): Promise<void> {
    return deleteSessionQuery(this.db, input);
  }

  getSession(input: GetSessionInput): Promise<SessionRecord<SessionCustom> | undefined> {
    return getSessionQuery(this.db, input);
  }

  getOwnedIds(input: GetOwnedIdsInput): Promise<readonly string[]> {
    return getOwnedIdsQuery(this.db, input);
  }

  getSessionByExternalId(input: GetSessionByExternalIdInput): Promise<SessionRecord<SessionCustom> | undefined> {
    return getSessionByExternalIdQuery(this.db, input);
  }

  updateSession(input: UpdateSessionInput<SessionCustom>): Promise<void> {
    return updateSessionQuery(this.db, input);
  }

  async listSessions(
    input: ListSessionsInput,
  ): Promise<{ data: SessionRecord<SessionCustom>[]; pagination: TokenPagination }> {
    const result = await listSessionsQuery(this.db, input);
    return {
      data: result.data,
      pagination: {
        limit: input.limit,
        ...result.pagination,
      },
    };
  }

  async createTurn(input: CreateTurnInput<TurnCustom>): Promise<void> {
    await createTurnQuery(this.db, {
      session_id: input.turn.session_id,
      turn: {
        turn_id: input.turn.turn_id,
        first_turn_id: input.turn.first_turn_id,
        previous_turn_id: input.turn.previous_turn_id,
        ancestor_ids: input.turn.ancestor_ids,
        input: input.turn.input,
        state: input.turn.state,
        custom: input.turn.custom,
      },
      new_threads: input.new_threads.map((thread): NewThreadRegistration => ({
        thread_id: thread.thread_id,
        parent: thread.parent,
        agent_info: thread.agent_info,
      })),
      new_context_appends: input.new_context_appends,
      capability_states: input.capability_states,
      last_activity_timestamp_ms: Date.now(),
      update_session_title_if_not_exist: input.update_session_title_if_not_exist,
      mcp_servers: null,
      sandbox_info: null,
    });
  }

  freezeAndGetTurn(input: FreezeAndGetTurnInput): Promise<TurnRecord<TurnCustom>> {
    return freezeAndGetTurnQuery(this.db, input);
  }

  getTurn(input: GetTurnInput): Promise<TurnRecord<TurnCustom> | undefined> {
    return getTurnQuery(this.db, input);
  }

  async listTurns(
    input: ListTurnsInput,
  ): Promise<{ data: TurnRecordWithoutSnapshot<TurnCustom>[]; pagination: TokenPagination }> {
    const offset = decodeOffsetPageToken(input.page_token);
    const result = await listTurnsQuery(this.db, {
      session_id: input.session_id,
      limit: input.limit,
      offset,
    });
    const pagination: TokenPagination = { limit: input.limit };
    if (result.next_offset !== null) {
      pagination.next_page_token = encodeOffsetPageToken(result.next_offset);
    }
    if (offset > 0) {
      pagination.previous_page_token = encodeOffsetPageToken(Math.max(0, offset - input.limit));
    }
    return { data: result.turns, pagination };
  }

  updateTurnState(input: UpdateTurnStateInput): Promise<void> {
    return updateTurnStateQuery(this.db, input);
  }

  appendToEvents(input: AppendToEventsInput): Promise<void> {
    return appendToEventsQuery(this.db, input);
  }

  addThreads(input: AddThreadsInput): Promise<void> {
    return addThreadsQuery(this.db, input);
  }

  removeThreads(input: RemoveThreadsInput): Promise<void> {
    return removeThreadsQuery(this.db, input);
  }

  appendToThreadContext(input: AppendToThreadContextInput): Promise<void> {
    return appendToThreadContextQuery(this.db, input);
  }

  overwriteThreadContext(input: OverwriteThreadContextInput): Promise<void> {
    return overwriteThreadContextQuery(this.db, input);
  }

  patchMCPServers(input: PatchMCPServersInput): Promise<void> {
    return patchMCPServersQuery(this.db, input);
  }

  patchSandboxInfo(input: PatchSandboxInfoInput): Promise<void> {
    return patchSandboxInfoQuery(this.db, input);
  }

  patchThreadCapabilityState(input: PatchThreadCapabilityStateInput): Promise<void> {
    return patchThreadCapabilityStateQuery(this.db, input);
  }

  listTurnEvents(input: ListTurnEventsInput): Promise<{ data: PersistedTurnEvent[]; pagination: TokenPagination }> {
    return listTurnEventsQuery(this.db, input);
  }

  listSessionEvents(input: ListSessionEventsInput): Promise<{ data: SessionEventItem[]; pagination: TokenPagination }> {
    return listSessionEventsQuery(this.db, input);
  }

  // --- temporary SF→TrueForge migration (remove after backfill) ---

  async getImportCheckpoint(): Promise<{ created_at: string | null }> {
    const row = await this.db
      .selectFrom('session')
      .select(sql<string | null>`min(created_at)`.as('created_at'))
      .where(sql<boolean>`metadata @> ${json({ imported: 'true' })}`)
      .executeTakeFirst();
    if (row?.created_at == null) {
      return { created_at: null };
    }
    return { created_at: new Date(row.created_at).toISOString() };
  }

  async importSessionSnapshot(
    input: ImportSessionRequest,
  ): Promise<{ imported: boolean; session_id: string }> {
    const sessionId = input.session.session_id;
    const agentName = input.session.agent_name;
    const agentSpec = input.session.agent_spec;
    const hasName = typeof agentName === 'string' && agentName.length > 0;
    const hasSpec = agentSpec != null;

    if (!hasName && !hasSpec) {
      throw new Error('Provide exactly one of agent_name or agent_spec');
    }

    // Prefer linking to a local agent when present; otherwise keep agent_name and leave agent_id null
    // so history still imports (agent may be backfilled later).
    let agentId: string | null = null;
    let resolvedAgentName: string | null = hasName ? agentName : null;
    if (hasName) {
      const agent = await this.db
        .selectFrom('agent')
        .select(['id', 'name'])
        .where('tenant_id', '=', input.session.tenant_id)
        .where('name', '=', agentName)
        .executeTakeFirst();
      if (agent !== undefined) {
        agentId = agent.id;
        resolvedAgentName = agent.name;
      }
    }

    return this.db.transaction().execute(async trx => {
      const { session, turns } = input;
      const inserted = await trx
        .insertInto('session')
        .values({
          tenant_id: session.tenant_id,
          session_id: sessionId,
          created_by_subject: json(session.created_by_subject),
          source: null,
          agent_id: agentId,
          agent_name: resolvedAgentName,
          agent_spec: hasSpec ? jsonUnknown<AgentSpec>(agentSpec) : null,
          title: session.title,
          last_turn_id: session.last_turn_id,
          custom: session.custom !== null ? json(session.custom) : null,
          metadata: json({ imported: 'true' }),
          external_id: null,
          metrics: json({ total_duration_ms: 0, total_turns: turns.length }),
          last_activity_timestamp_ms: session.last_activity_timestamp_ms,
          created_at: new Date(session.created_at),
          updated_at: new Date(session.updated_at),
        })
        .onConflict(oc => oc.column('session_id').doNothing())
        .returning('session_id')
        .executeTakeFirst();
      if (inserted === undefined) {
        return { imported: false, session_id: sessionId };
      }

      for (const turn of turns) {
        const turnId = turn.turn_id;
        const updatedAt = new Date(turn.updated_at);
        await trx
          .insertInto('turn')
          .values({
            session_id: sessionId,
            turn_id: turnId,
            first_turn_id: turn.first_turn_id,
            previous_turn_id: turn.previous_turn_id,
            ancestor_ids: turn.ancestor_ids,
            input: jsonUnknown<TurnInputItem[]>(turn.input),
            state: jsonUnknown<TurnState>(turn.state),
            checkpoint: jsonUnknown<TurnCheckpoint>(
              turn.checkpoint ?? { mcp_servers: null, sandbox_info: null },
            ),
            custom: turn.custom !== null ? json(turn.custom) : null,
            created_at: new Date(turn.created_at),
            updated_at: updatedAt,
          })
          .execute();

        for (const thread of turn.threads) {
          const threadId = thread.thread_id;
          const contextIds: number[] = [];
          if (thread.context.length > 0) {
            const rows = await trx
              .insertInto('thread_context_log')
              .values(
                thread.context.map(msg => ({
                  session_id: sessionId,
                  thread_id: threadId,
                  turn_id: turnId,
                  body: jsonUnknown<ContextMessage>(msg),
                  created_at: updatedAt,
                })),
              )
              .returning(['append_id'])
              .execute();
            for (const row of rows) {
              contextIds.push(row.append_id);
            }
          }

          await trx
            .insertInto('turn_thread')
            .values({
              session_id: sessionId,
              turn_id: turnId,
              thread_id: threadId,
              checkpoint: jsonUnknown<TurnThreadCheckpoint>({
                parent: thread.parent,
                completion: thread.completion,
              }),
              agent_info: thread.agent_info !== null ? jsonUnknown<AgentInfo>(thread.agent_info) : null,
              current_context_usage: jsonUnknown<CurrentContextUsage>(thread.current_context_usage),
              context_ids: contextIds,
              updated_at: updatedAt,
            })
            .execute();

          if (thread.capability_state !== null && Object.keys(thread.capability_state).length > 0) {
            await trx
              .insertInto('thread_capability_state')
              .values(
                Object.entries(thread.capability_state).map(([key, state]) => ({
                  session_id: sessionId,
                  turn_id: turnId,
                  thread_id: threadId,
                  key,
                  state: jsonUnknown<JsonValue>(state),
                  updated_at: updatedAt,
                })),
              )
              .execute();
          }
        }

        if (turn.events.length > 0) {
          await trx
            .insertInto('session_event')
            .values(
              turn.events.map(event => ({
                session_id: sessionId,
                turn_id: turnId,
                event_id: event.id,
                event: jsonUnknown<PersistedTurnEvent>(event),
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
