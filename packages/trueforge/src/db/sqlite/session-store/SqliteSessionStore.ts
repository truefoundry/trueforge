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
import type { Kysely } from 'kysely';
import type { Database } from '../types';
import { patchThreadCapabilityState as patchThreadCapabilityStateQuery } from './queries/capabilities';
import {
  appendToEvents as appendToEventsQuery,
  listSessionEvents as listSessionEventsQuery,
  listTurnEvents as listTurnEventsQuery,
} from './queries/events';
import {
  createSession as createSessionQuery,
  deleteSession as deleteSessionQuery,
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
 * ## Design: append-only context log + per-turn position table
 *
 * Message bodies live in `thread_context_log`, append-only, written exactly
 * once; ids are SQLite AUTOINCREMENT (`append_id`). A turn's context per thread
 * is ordered rows in `turn_thread_context (pos, append_id)` — no array column.
 * Turns share no mutable structure: linear continuation and fork are the same
 * copy path (parent context mapping rows + new mapping rows), overwrite deletes
 * the current mapping and inserts a fresh one, and a still-running ancestor's
 * late appends touch only its OWN rows — structural leaks are impossible.
 *
 * Hard invariants:
 * 1. A turn cannot be used as `previous_turn_id` while it is still `running` —
 *    `createTurn` rejects that; callers must `freezeAndGetTurn` first.
 *    Tip-equality is NOT required: new roots and concurrent forks from a
 *    finished tip can leave more than one turn `running` at once.
 * 2. Every turn-scoped write is fenced on `state->>'status' = 'running'`.
 * 3. Terminal turns are IMMUTABLE — a terminal read is a final read.
 * 4. BEGIN IMMEDIATE provides write locking (no FOR SHARE / FOR UPDATE).
 */
export class SqliteSessionStore implements ISessionStore<SessionCustom, TurnCustom> {
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
}
