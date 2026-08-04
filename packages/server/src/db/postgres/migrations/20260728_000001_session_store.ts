import { sql, type Kysely } from 'kysely';

/**
 * Session-store tables (canonical DDL owner).
 *
 * Write-heat summary: `turn_thread` is the one deliberately-hot table with its hot
 * columns (`context_ids`, `current_context_usage`) isolated from the pointer-carried
 * big ones (`agent_info`, `checkpoint`); `session`, `turn`, and
 * `thread_capability_state` take small bounded HOT-friendly updates; the two logs
 * are pure insert. Nothing ever rewrites a large value except the array concat
 * itself — the documented, bounded cost of the raw-array model.
 *
 * Column placement rule: top-level column ONLY if (a) key/query target, (b) hot
 * write target (isolated so nothing else churns with it; typed operators), or
 * (c) big-and-immutable (own TOAST value carried by pointer through row rewrites).
 * Everything small/rare/descriptive inlines into a store-owned extensible
 * `checkpoint` jsonb. `custom` is always its own column: `checkpoint` is
 * store-owned, `custom` is caller-owned.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await db.schema
    .createTable('session')
    // key
    .addColumn('tenant_id', 'text', col => col.notNull())
    // key
    .addColumn('session_id', 'text', col => col.notNull())
    // top: big + immutable-in-practice (updateSession patch only);
    //      TOAST pointer rides through per-turn tip bumps untouched
    .addColumn('agent_spec', 'jsonb', col => col.notNull())
    // top: list-displayed, independently patched; first-write-wins
    //      (COALESCE) targets it directly
    .addColumn('title', 'text')
    // top: HOT — bumped once per createTurn under the session lock;
    //      tiny fixed-width column keeps the bump a cheap HOT update
    .addColumn('last_turn_id', 'text')
    // top: caller-owned opaque extension; never mixed with store state
    .addColumn('custom', 'jsonb')
    // top: hot, bumped with the tip ("activity" = turn creation)
    .addColumn('last_activity_timestamp_ms', 'bigint', col => col.notNull())
    // top: list ordering (indexed below)
    .addColumn('created_at', 'timestamptz', col => col.notNull())
    .addColumn('updated_at', 'timestamptz', col => col.notNull())
    .addPrimaryKeyConstraint('session_pkey', ['tenant_id', 'session_id'])
    // headroom so the per-turn bump stays HOT (no index churn)
    .modifyEnd(sql`WITH (fillfactor = 85)`)
    .execute();

  await db.schema
    .createIndex('session_list_idx')
    .on('session')
    .columns(['tenant_id', 'created_at', 'session_id'])
    .execute();

  await db.schema
    .createTable('turn')
    // key
    .addColumn('tenant_id', 'text', col => col.notNull())
    // key
    .addColumn('session_id', 'text', col => col.notNull())
    // key (ulid)
    .addColumn('turn_id', 'text', col => col.notNull())
    // top: immutable topology; filter target
    .addColumn('first_turn_id', 'text', col => col.notNull())
    // top: immutable topology; NULL = session's first turn
    .addColumn('previous_turn_id', 'text')
    // top: immutable; queried by the anchored ancestor-chain walk
    //      (spill through older turns); typed array
    .addColumn('ancestor_ids', sql`text[]`, col => col.notNull())
    // top: big + written once at create; TOAST pointer stable after
    .addColumn('input', 'jsonb', col => col.notNull())
    // top: THE fence/freeze target — every gated write predicates on
    //      state->>'status'; exactly one terminal flip per turn
    .addColumn('state', 'jsonb', col => col.notNull())
    // inlined: {mcp_servers, sandbox_info, ...future} — both small,
    //      patched at most once or twice per turn (resource init);
    //      extensible without migration
    .addColumn('checkpoint', 'jsonb', col => col.notNull())
    // top: caller-owned opaque extension
    .addColumn('custom', 'jsonb')
    // top: list ordering (indexed below)
    .addColumn('created_at', 'timestamptz', col => col.notNull())
    .addColumn('updated_at', 'timestamptz', col => col.notNull())
    .addPrimaryKeyConstraint('turn_pkey', ['tenant_id', 'session_id', 'turn_id'])
    // headroom for the state flip + rare checkpoint patches
    .modifyEnd(sql`WITH (fillfactor = 85)`)
    .execute();

  await db.schema
    .createIndex('turn_list_idx')
    .on('turn')
    .columns(['tenant_id', 'session_id', 'created_at', 'turn_id'])
    .execute();

  // the complete STATE of one thread at one turn
  await db.schema
    .createTable('turn_thread')
    // key
    .addColumn('tenant_id', 'text', col => col.notNull())
    // key
    .addColumn('session_id', 'text', col => col.notNull())
    // key
    .addColumn('turn_id', 'text', col => col.notNull())
    // key
    .addColumn('thread_id', 'text', col => col.notNull())
    // inlined: {parent, completion, ...future} — parent: small,
    //      immutable; completion: can be big but written ONCE at
    //      thread end (rare + terminal); the hot path below never
    //      touches this jsonb
    .addColumn('checkpoint', 'jsonb', col => col.notNull())
    // top: big + immutable thread IDENTITY. Real data: sub-agent
    //      instructions in one working session ran 2.4–8.8KB
    //      (median 4.4KB) — always past the ~2KB TOAST threshold,
    //      so a dedicated column lets every array rewrite carry the
    //      TOAST value by pointer instead of re-serializing it.
    //      Deliberately duplicates context[0] (the task is also the
    //      thread's first user message): the log copy is
    //      conversation state and compaction may reclaim it; this
    //      copy is identity and must survive context surgery
    //      (restore re-resolves the child definition from
    //      name/model/input here). NULL for the root thread.
    .addColumn('agent_info', 'jsonb')
    // top: hot — set by the SAME single-statement UPDATE as the
    //      array concat (zero extra row versions; ~300B inline;
    //      byte-neutral vs stamping log rows). Kept out of
    //      checkpoint so the jsonb never rewrites on the hot path.
    //      Escape hatch: if the array ever becomes write-once
    //      (ranges / writer-filter), move this back onto
    //      thread_context_log rows (previously validated design).
    .addColumn('current_context_usage', 'jsonb', col => col.notNull())
    // top: THE context — log append_ids in context order. Hot
    //      concat target (`||`), typed bigint[] operator; dominant
    //      TOAST value (~8KB at 1k live messages, entire value
    //      rewritten per append batch — the accepted cost of the
    //      raw-array choice; range-encoding is the recorded shrink
    //      if measured).
    .addColumn('context_ids', sql`bigint[]`, col => col.notNull())
    .addColumn('updated_at', 'timestamptz', col => col.notNull())
    .addPrimaryKeyConstraint('turn_thread_pkey', ['tenant_id', 'session_id', 'turn_id', 'thread_id'])
    // the ONE deliberately-hot table: rewritten 5–10x while its
    // turn runs; immutable once the turn is terminal (fence)
    .modifyEnd(sql`WITH (fillfactor = 70)`)
    .execute();

  await db.schema
    .createTable('session_event')
    // key
    .addColumn('tenant_id', 'text', col => col.notNull())
    // key
    .addColumn('session_id', 'text', col => col.notNull())
    // top: every read is turn-scoped or turn-attributed (envelope)
    .addColumn('turn_id', 'text', col => col.notNull())
    // top/key: event.id, a process-local monotonic ULID minted when the event is
    //      created. Lexical ordering preserves the single turn writer's creation
    //      order, including events created in the same millisecond.
    //
    // A database auto-increment id is deliberately not used: it assigns order
    //      at persistence rather than event creation, couples the contract to
    //      Postgres, and sequence allocation across pooled connections,
    //      transactions, retries, or larger sequence caches need not represent
    //      logical event order. The event already owns a portable unique id, so
    //      a second store-generated identity would duplicate identity and make
    //      ordering backend-dependent.
    //
    // See https://github.com/ulid/spec#monotonicity
    .addColumn('event_id', 'text', col => col.notNull())
    // top: PersistedTurnEvent payload, written once
    .addColumn('event', 'jsonb', col => col.notNull())
    // top: copied from event.created_at (required by PersistedTurnEvent), so
    //      future time-range filters can be indexed without inspecting jsonb.
    //      Ordering still uses event_id.
    .addColumn('created_at', 'timestamptz', col => col.notNull())
    .addPrimaryKeyConstraint('session_event_pkey', ['tenant_id', 'session_id', 'turn_id', 'event_id'])
    // pure INSERT → fillfactor 100
    .execute();

  // pure immutable CONTENT; no state → no checkpoint field
  await db.schema
    .createTable('thread_context_log')
    // key
    .addColumn('tenant_id', 'text', col => col.notNull())
    // key
    .addColumn('session_id', 'text', col => col.notNull())
    // key
    .addColumn('thread_id', 'text', col => col.notNull())
    // top: THE message id — store-assigned (the delta createTurn
    //      interface killed content addressing: the store is told
    //      what's new, so no hashing/dedupe); consumed by
    //      data-modifying CTE in the same statement (RETURNING
    //      → array concat, one network call). bigint on purpose:
    //      no exhaustion (~290M years at 1k msg/s; int4 would die
    //      in months). NOT an order key: the array is the sole
    //      order authority (reads use unnest WITH ORDINALITY).
    //      Cross-statement id order is NEVER relied on for context
    //      (pool + sequence CACHE could invert it); the only id
    //      ordering used is INTRA-statement (array_agg ORDER BY
    //      append_id over one INSERT's RETURNING = VALUES order,
    //      backend-local, safe under any CACHE setting)
    .addColumn('append_id', 'bigint', col => col.notNull().generatedAlwaysAsIdentity())
    // top: provenance — which turn wrote the row; debugging + the
    //      future writer-filter migration; tiny; NOT used for
    //      visibility (the array is the sole visibility authority)
    .addColumn('turn_id', 'text', col => col.notNull())
    // top: the ContextMessage — written exactly once, never updated
    .addColumn('body', 'jsonb', col => col.notNull())
    // top: future indexed time filters without a table rewrite
    .addColumn('created_at', 'timestamptz', col => col.notNull())
    .addPrimaryKeyConstraint('thread_context_log_pkey', ['tenant_id', 'session_id', 'thread_id', 'append_id'])
    // pure INSERT → default fillfactor 100, zero dead tuples;
    // cleanup is whole-session delete only
    .execute();

  // PER-TURN KV snapshot, latest-wins per (turn, thread, key)
  await db.schema
    .createTable('thread_capability_state')
    // key
    .addColumn('tenant_id', 'text', col => col.notNull())
    // key
    .addColumn('session_id', 'text', col => col.notNull())
    // key: capability history is PER TURN — fork/restore from any
    //      turn must see the map AS OF that turn, and a frozen
    //      turn's map must never change under it. (A cross-turn
    //      latest-wins PK was tried and REVERTED for exactly the
    //      fork reason.)
    .addColumn('turn_id', 'text', col => col.notNull())
    // key
    .addColumn('thread_id', 'text', col => col.notNull())
    // key: capability state key; `tfy.` prefix reserved
    .addColumn('key', 'text', col => col.notNull())
    // top: the value IS the row — JsonValue (undefined banned at
    //      the harness boundary); NULL = explicitly cleared
    .addColumn('state', 'jsonb')
    .addColumn('updated_at', 'timestamptz', col => col.notNull())
    .addPrimaryKeyConstraint('thread_capability_state_pkey', ['tenant_id', 'session_id', 'turn_id', 'thread_id', 'key'])
    // single-statement fenced upsert per CAPABILITY_STATE event
    .modifyEnd(sql`WITH (fillfactor = 85)`)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await db.schema.dropTable('thread_capability_state').ifExists().cascade().execute();
  await db.schema.dropTable('thread_context_log').ifExists().cascade().execute();
  await db.schema.dropTable('session_event').ifExists().cascade().execute();
  await db.schema.dropTable('turn_thread').ifExists().cascade().execute();
  await db.schema.dropTable('turn').ifExists().cascade().execute();
  await db.schema.dropTable('session').ifExists().cascade().execute();
}
