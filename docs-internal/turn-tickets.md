Client contract (no resume API): while paused, the client only sends events and/or subscribes. When every required approval (or other HITL action) is resolved, the server automatically transitions the tip to running and continues the state machine. The client does not call resume.

Typical orders (both valid):

Subscribe, then send event(s)

Send event(s), then subscribe

Concurrent subscribe + send

What already exists (do not rebuild)

Area

Where

Notes

In-memory ActiveTurn registry

packages/trueforge/src/runtime/activeTurns.ts

track / cancelIfRunning / shutdownAndWait + AbortController. Cleanup on stream finally.

Executor id + turn-id peering

runtime/peeringIds.ts, main.ts

EXECUTOR_ID at boot; turn ids mint with executor; standalone disables peering.

Redis request/reply + heartbeat

main.ts + config REDIS_REQUEST_REPLY_*

Cancel (and peers) forwarded to owning replica. Heartbeat keys already exist — reuse for steal policy later.

Dual-write events

TurnHandle + session store + runtime/event-subscription/

PG append + Redis tailable subscribe. List = PG; subscribe = Redis.

First-terminal-write / freeze CAS

freezeAndGetTurn, updateTurnState

Pattern for “only mutate if still running” — ownership CAS should look like this.

Pause encoded as terminal today

TurnStateDone + required_actions

Continue = new createTurn with user.tool_approval. Product wants same-turn paused + send-event continue.

Approvals (product, current)

core ToolSet / AgentThread + UI

Per-tool_call_id allow/deny. Policies (user.tool_approval_policy) not shipped.

P0 — Foundations (schema + ownership field)

TF-OWN-1 ✅ — Add paused turn status (schema + OpenAPI only)

Goal: Introduce TurnStatePaused (status paused, action refs / action_required_on_events, paused_at, optional expires_at) without wiring runtime yet. Keep writing done+RA in runtime.
Touches: trueforge-core turn schemas; regenerate OpenAPI/SDK if required by repo process; types that assume terminal = donecancellederror.
Done when: Types compile; unit tests for schema parse; runtime behavior unchanged.
Depends on: —
Size: S

TF-OWN-2 ✅ — Persist active_executor_id (+ generation) on turn row

Goal: Migration: columns on session turn table (Postgres; SQLite if standalone needs parity later). Values set on createTurnto current EXECUTOR_ID (generation = 1 or nonce). Prefer seed/backfill from turn-id executor suffix rather than null. Read/write via store. No CAS yet.
Touches: PG migration, store types, createTurn insert path.
Done when: New turns store executor; getTurn returns it; old rows backfilled from turn id when possible.
Depends on: —
Size: S–M

TF-OWN-3 — Owner CAS + TurnHandle wire + per-turn mutex (single PR; was 3–5)

Goal: One PR that makes “only the recorded owner may save progress” real end-to-end, plus same-process serialize:

Store CAS — Extend (or add *IfOwner) progress writes (updateTurnState, appendToEvents, appendToThreadContext, and other fenced mutators used by execution) so they succeed only if active_executor_id (+ generation) matches an expected_active_executor_id input. Same-statement conditional update (not read-then-write). Mirror today’s running fence style. Do not put owner CAS on freezeAndGetTurn / cancel — non-owners must still be able to stop a tip.

TurnHandle wire — Pass ownership token from begin-execution into TurnHandle; all persist calls use the owner-fenced APIs. On CAS failure → stop stream / lost-ownership error.

In-memory per-turn mutex — withTurnLock(sessionId, turnId, fn) on ActiveTurnRegistry (or thin wrapper) so concurrent handlers on the same turn don’t interleave across await.

Semantic change: Happy path unchanged (single owner matches column). New: wrong executor cannot append/update even while status is still running; same-process concurrent handlers for one turn run one-at-a-time. No pause flip, no steal, no client API change.

Touches: session-store queries + ISessionStore; TurnHandle; apis/turns.ts begin execution; activeTurns.ts; contract + unit tests.
Done when: Owner write OK; stale executor rejected; forced wrong-executor test fails closed; overlapping lock tasks serialize per key / parallel across keys.
Depends on: TF-OWN-2
Size: L (one PR)

P1 — Pause = keepalive then offload ActiveTurn

TF-OWN-6 — Write paused instead of done+RA on HITL stop

Goal: When orchestrator returns with required actions, TurnHandle writes tip as paused (not done). Emit turn.update with paused state. done only when finished with no open HITL. SSE/stream segment ends; tip stays paused on the same turn_id.
Touches: TurnHandle, turn schemas usage, SDK event consumers/docs later.
Done when: Gated-tool test: tip status paused; client stream segment ends.
Depends on: TF-OWN-1, TF-OWN-3
Size: M

TF-OWN-7 — Keepalive ActiveTurn on pause, then forced offload

Goal: Do not drop ActiveTurn the instant tip becomes paused. Users often approve/deny right after pause — keep the live machine for a short grace / keepalive TTL, then abort + remove.

On pause (OWN-6): tip → paused; stream segment ends; ActiveTurn stays registered (generator idle / waiting for inbound, not holding an open client SSE forever).

During grace: send-event / apply on the same replica uses the existing ActiveTurn (per-turn lock + inbox); no rebuild.

After grace (or on cancel / shutdown / explicit offload): abort AbortController, remove registry entry; verify no leaked generator. Later send/subscribe uses OWN-9 rebuild (same owner) or steal (later).

Config: tunable keepalive TTL (e.g. 30s–2m); document that grace ≠ cross-replica HA (steal still required after owner death/deploy).

Touches: activeTurns.ts (track paused + expiry timer / sweep); turns API pause path; config; tests.
Done when:

Immediate post-pause send on same process hits live ActiveTurn (no rebuild).

After TTL: cancelIfRunning is false; registry empty for that tip; abort observed.

Cancel/shutdown still clears ActiveTurn without waiting for TTL.

Depends on: TF-OWN-6
Size: M

TF-OWN-8 — cancelTurn works for paused

Goal: cancelSessionTurn accepts paused (not only running); marks cancelled; clears ownership or bumps generation as designed.
Touches: sessions/turns cancel API + store.
Done when: Cancel paused tip → cancelled; createTurn can continue session.
Depends on: TF-OWN-6
Size: S

P2 — Same-replica wake / rebuild (no steal yet)

TF-OWN-9 — Rebuild ActiveTurn from TurnRecord (same owner)

Goal: If tip is paused, active_executor is us, but no registry entry (keepalive expired / offloaded) → rebuild orchestrator from snapshot without changing ownership. Used when send-event or subscribe needs a live machine after grace. During keepalive, skip rebuild and use the existing ActiveTurn.
Touches: new helper near SessionHandle / turns API; core snapshot load.
Done when: Rebuild produces runnable handle from stored snapshot; not used when ActiveTurn still present.
Depends on: TF-OWN-6, TF-OWN-7
Size: M

P3 — Cross-replica ownership (steal)

TF-OWN-11 — Peer using DB Active Executor (not only turn-id embedding)

Goal: Cancel / send-event / subscribe resolution: read active_executor_id from TurnRecord; peer via existing request/reply. Fallback: parse turn id only if column null (legacy).
Touches: sessions cancel + send-event + subscribe routing.
Done when: Multi-replica cancel still works; uses DB field when set.
Depends on: TF-OWN-2, existing peering
Size: M

TF-OWN-12 — Steal: CAS claim ownership

Goal: claimTurnOwnership(turnId, expectedExecutor, newExecutorWithGeneration) atomic update. On success caller may rebuild. On failure return conflict. No advisory lock in v1.
Touches: store + unit tests for concurrent claim.
Done when: Two concurrent claims → exactly one winner.
Depends on: TF-OWN-3 (store owner fence exists)
Size: S–M

TF-OWN-13 — Steal path on send-event / subscribe when peer fails

Goal: Wire: peer → on timeout/no responder → claim (TF-OWN-12) → rebuild → proceed. Log heavily. Use existing heartbeat TTL to prefer not stealing if heartbeat fresh.
Touches: send-event + subscribe routing.
Done when: Kill owner mid-pause; other replica can accept send-event + subscribe after claim.
Depends on: TF-OWN-11, TF-OWN-12, TF-OWN-9
Size: M–L

TF-OWN-14 — (Optional later) 409 busy + retry semantics

Goal: If claim lost or rebuild in progress, return 409; document client retry for subscribe/send ordering. Only if TF-OWN-13 shows stampedes.
Depends on: TF-OWN-13
Size: S

P4 — Durable inbound inbox

TF-OWN-15 ✅ — session_inbound_events table + store API

Goal: Migration + insert/list-unconsumed/mark-consumed. One session inbox for the shared send API: PK (session_id, event_id), nullable turn_id (tip HITL vs future session-only policy), payload jsonb (SendTurnEventItem today), consumed, created_at. No idempotency_key.
Done when: Store contract tests CRUD + consume + null turn_id filter (PG / SQLite / InMemory).
Depends on: — (parallel after P0)
Size: S–M

TF-OWN-16 — Deprecate createTurn-for-approvals

Goal: Stop using a new createTurn with user.tool_approval / user.tool_response to continue after HITL. That path exists only because pause is still encoded as done+required_actions. Once OWN-6 + OWN-10 land, tip stays paused and clients use session send-event on the same turn_id.

Reject (or no longer document) approval/tool-response-only createTurn input once send-event works.

Update UI / SDK / tests to POST session events instead.

Keep createTurn for real new tips (user.message, steer after dismiss, etc.).

Done when: Gated-tool continue uses send-event only; createTurn approval fixtures/routes removed or fail closed.
Depends on: TF-OWN-6, TF-OWN-10 (and ideally TF-OWN-10b)
Size: S–M

P5 — Send event + auto-continue (no resume API)

TF-OWN-10 — POST .../sessions/{session_id}/events (send only)

Goal: Public session send-event API + durable apply path. No “resume” verb.

API — POST …/sessions/{session_id}/events with required body turn_id (not path) + SendTurnEventItems (user.tool_approval / user.tool_response). OpenAPI + SDK. Targets paused (or running, if allowed) tip; reject stale turn_id. user.message stays on createTurn / steer; approval policies are a later PR (may relax turn_id to optional/null).

Inbox-first — Persist rows in session_inbound_events (consumed=false) under owner CAS + per-turn lock beforeorchestrator side effects; mark consumed when applied (with persist TX as designed).

Wake — Resolve owner / rebuild / steal as needed; queue into live or rebuilt ActiveTurn.

Rebuild replay — OWN-9 loads unconsumed inbox rows into pending before execute (was OWN-17).

Done when: Client can send approvals/tool responses while paused; events durable before apply; rebuild after offload replays unconsumed.
Depends on: TF-OWN-15, TF-OWN-9, TF-OWN-3 (per-turn lock + owner CAS)
Size: M–L

TF-OWN-10b — Auto-continue when HITL fully resolved

Goal: After applying inbound events, if no required actions remain → emit turn.update with status: running (or equivalent) and automatically start/continue the state machine on the same turn_id. Client never calls resume. Partial approvals: tip stays paused.
Done when: Send all approvals → server emits running → tools/LLM continue on same turn without a second client “resume” call.
Depends on: TF-OWN-10, TF-OWN-9
Size: M (pair with senior on TurnHandle)

TF-OWN-10c — Subscribe + send ordering tests

Goal: Integration tests for: subscribe-then-send, send-then-subscribe, concurrent. Assert no missed running / tool events when Redis backfill not yet landed (may soft-depend on P5 backfill).
Depends on: TF-OWN-10b
Size: S–M

P5b — Redis backfill

TF-OWN-18 — Detect Redis behind Postgres + backfill helper

Goal: Compare last event ids; if stream missing or behind, append missing PG events to Redis idempotently. Spike: Redis entry id strategy.
Depends on: event-subscription redis impl
Size: M (include short design note in PR)

TF-OWN-19 — Call backfill on steal / same-owner rebuild before subscribe

Goal: Wire TF-OWN-18 into wake paths so subscribe after steal doesn’t miss.
Depends on: TF-OWN-18, TF-OWN-13
Size: S–M

P6 — Policies, TTL

TF-OWN-20 — user.tool_approval_policy schema + apply (session-scoped)

Goal: Separate PR: schema for allow_once / allow_session + expire; session policy map; ToolSelectorPolicy consults it. Policies are session-scoped — may be sent with no tip running. Optional later: also deliver on a paused tip to clear matching HITL.
Depends on: — (can parallel tip send path)
Size: M

TF-OWN-21 — Pause TTL + controller synthetic deny events

Goal: expires_at on paused; controller sends deny events via same send-event/inbox path (or internal equivalent), then auto-continue. Never auto-allow.
Depends on: TF-OWN-10b, TF-OWN-13, controller patterns
Size: M

P7 — Hardening

TF-OWN-23 — Heartbeat-gated steal policy + metrics

False-steal rate, claim conflicts, send-event / subscribe latency.

TF-OWN-24 — Idempotency keys on POST events

Optional unique constraint path.

TF-OWN-25 — AbortController / registry audit under failure mid dual-write

Chaos tests.

Out of scope for this epic

Temporal / workflow engine migration

Client-facing resumeTurn / resumeTurnStream API

Code Mode ApprovalHold (sandbox in-script HITL) — separate epic after send-event auto-continue works for direct MCP

Park-and-steer pending tray

Advisory locks unless CAS-only proven insufficient
