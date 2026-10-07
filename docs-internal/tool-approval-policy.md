# Tool approval policy — persistent approvals ("Approve for session / N minutes")

## Goal

Let a user grant a sticky approval for a tool so future calls to that tool are
auto-allowed without a per-call approval prompt. "Approve once" stays a one-off
decision and is never stored.

## Design decisions

- **Storage**: recorded on the turn snapshot's `mcp_servers[server]` entry as
  `approval_policies`, keyed per tool name. No separate store/table. It rides
  the existing snapshot carry-forward (`previousSnapshot.mcp_servers` deep-copy)
  and cross-turn read, exactly like `session_id`.
- **"Approve once"**: one-off; never becomes a stored policy.
- **Keying**: by tool name. Accepted limitation — if the tool is renamed or the
  MCP side changes the name, the policy no longer matches and is dead.
- **`user.tool_approval_policy` is not tied to a pending approval**: the client
  can post it at any time. Whenever it lands it is validated in the turn it
  arrives in, merged into the snapshot, and becomes part of the ToolSet.
- **Re-evaluation**: when a policy lands, every still-pending approval
  re-evaluates against the new policies; a matching policy resolves it without a
  per-call decision. Non-matching pending approvals stay paused.
- **Expiry**: `expire_at` present = "Approve for N minutes"; absent = "Approve
  for session". Evaluated at tool-call time (no proactive timer/wake for v1).

## Change list

### 1. Snapshot schema — add `approval_policies` to the server entry

Extend `MCPServerInitInfoSchema` (the per-server snapshot value) with a per-tool
policy map: `approval_policies?: Record<toolName, { expire_at?: string }>`.
Rides existing carry-forward; no new store/table.

### 2. Runtime entry path for `user.tool_approval_policy`

**Decided:** arrives via `POST /{session_id}/turns/{turn_id}/events` (not
`createTurn`/`AgentSendInput`, which stays untouched). We assume the turn is
always awake for now — the orchestrator execute loop is treated as a long-running
loop, so no park/wake machinery. Re-evaluation of pending approvals lands with
items 3–4; item 2 is only transport + validate + snapshot merge.

Flow (all in-process, keyed by `${sessionId}:${turnId}`):

- `ActiveTurnRegistry` run entry gains a `submitInbound` sink, populated in
  `beginTurnExecution` from `turn.submitInbound`.
- `createTurnEventHandler` looks up the live run:
  - no live run → **409 Conflict** (a policy can only apply to a live turn for now).
  - live run → call `submitInbound(policyEvents)`; unknown `server_name` → **4xx**;
    otherwise merge + **201**.
- `TurnHandle.submitInbound` → `AgentThreadOrchestrator.applyApprovalPolicies`:
  validate each `server_name` against the live ToolSets (== `spec.mcp_servers`),
  merge policies into the in-memory ToolSet policy map (consumed by item 3), and
  persist the updated policies into the snapshot via `patchMCPServers` (full entry
  incl. `approval_policies`; see below).

**Persistence (store side) — single writer.** There is exactly one snapshot
writer for `mcp_servers`: `ISessionStore.patchMCPServers`, which replaces each
server entry **wholesale by id** (so pruned/expired policies drop from the durable
snapshot — self-cleaning). `MCPServerInitInfo` carries `approval_policies`, so
whoever writes an entry must include the ToolSet's current
`getApprovalPolicies()` alongside `id`/`name`/`session_id`/`transport_type`.
Two triggers both route through this one method:

1. **MCP init (wired).** The `MCP_INITIALIZE` handler persists each server entry;
   `convertMCPServersToTools` attaches each tool set's current policies
   (`getApprovalPolicies()`) onto the init info as it aggregates `wasInitialized`,
   so the wholesale init write carries sticky policies forward instead of
   clobbering them.
2. **Policy lands mid-turn (not wired yet).** The orchestrator's
   `applyApprovalPolicies` will call `patchMCPServers` with the full entry after
   merging the new policies into the ToolSet.

There is no separate policy-only store method — an earlier
`patchToolApprovalPolicies` was removed in favour of this single writer.
`patchMCPServers` is fenced on `state->>'status' = 'running'` and covered across
InMemory / sqlite / postgres in `storeContractSuite`.

- `AgentSendInput` / `toSendBatch` are NOT touched — the policy never enters a
  thread context or the send batch.

### 3. IMCP enforcement — policies become part of the ToolSet — DONE

`ToolSet` takes the per-server `approval_policies` at construction and makes
`is_approval_required` policy-aware (expiry checked against now):
`is_approval_required = toolSelectorPolicy.requiresApproval(...) && !hasApplicableApprovalPolicy(server, tool)`.
This one point covers both the `callTool` gate and the enrichment flag.
`ToolSelectorPolicy` stays pure; the policy check layers in `ToolSet`.
`TurnResourceResolver.resolveAgentDefinition` passes the snapshot's
`approval_policies` into `new ToolSet(...)`.

Implemented as:

- `ToolSet` constructor accepts `approvalPolicies` (carried-forward policies) and
  seeds the same map used by `setApprovalPolicy`.
- `ToolSet.hasApplicableApprovalPolicy(toolName)` — true when a policy exists and (no `expire_at`
  or `expire_at` is still in the future).
- `buildToolCallInfo`: `is_approval_required = toolSelectorPolicy.requiresApproval(...) && !hasApplicableApprovalPolicy(name)`
  — single point feeding both `callTool` gate and enrichment flag.
- `TurnResourceResolver` passes `previousTurn.snapshot.mcp_servers[name].approval_policies`
  into `new ToolSet(...)`.

### 4. Re-evaluate still-pending approvals when a policy lands — DONE

`is_approval_required` is baked onto the tool_call in context at creation, and the
pause derivation reads that baked flag — so a policy that lands mid-pause would, on
its own, leave the call stuck as "awaiting user input". **Derivation stays pure
(context only); the policy application updates context first.** When a policy is
processed, `execute()`'s drain applies it to the ToolSets _and_ reconciles the
already-pending calls in context, so `deriveAgentThreadState` /
`getPendingApprovalToolCalls` need no policy argument — they just read context.

**Context update = an inline decision marker, not a cleared flag.** Resolution is
represented by `tool_info.approval` — an optional field with the **same shape** as a
user approval decision (`{ status: 'allow' } | { status: 'deny', reason? }`, the
`ApprovalDecision` schema). It is the **same** marker an explicit user decision sets
(see below), so derivation has one uniform notion of "resolved" for both user decisions
and policy. The reconcile step sets `approval = { status: 'allow' }` on each still-open
approval-required call now covered by an applicable policy. It deliberately does
**not** clear `is_approval_required`, because `OpenToolCallCloser` (a preSend repair
pass that runs every resume) keys on `is_approval_required === true` to leave a call
open; clearing it would make the closer stub the call with a dummy "not executed"
response before `stepToolResponse` could run it. With the marker:

- `deriveAgentThreadState` / `getPendingApprovalToolCalls` treat a call as pending only
  when `is_approval_required === true && approval === undefined` → a covered call (or any
  resolved call, allow or deny) drops out and the thread becomes `tool-response-required`.
- `OpenToolCallCloser` still sees `is_approval_required === true` → leaves it open.
- `stepToolResponse` → `executeToolCalls` → `ToolSet.callTool(params, undefined)`
  recomputes `is_approval_required` from the (now-applied) ToolSet policy → `false`
  → runs the tool with no per-call decision. Pause derivation and `callTool` can
  never disagree, so the `approvalRequiredToolCalls` "Unreachable" throw cannot fire.

No approval-decision is synthesized for a policy. The marker is an **in-place mutation**
of an already-persisted assistant message, so it is flushed to the store with an
`AGENT_CONTEXT_OVERWRITE` carrying the full thread context and `reason:
'approval_resolution'` (a non-compaction overwrite: no LLM `usage`, bumps no
summarization metric). The store's `overwriteThreadContext` then persists it, so the
resolution survives reload.

**Applying one batch of user events emits one `UserEventsCommitEvent`
(`internal.user_events.commit`).** Acceptance happens inside the executor (the thread
drains its queued decisions at the top of its step; the orchestrator applies policies in
`execute()`'s drain), so that is where the commit is assembled. It is the unit of "user
events consumed" — it groups every durable write that must land together so
`TurnHandle.persistExecutionEvent` can persist them in one transaction (once a DB store
exists; sequential writes until then):

- `context_appends` — decision/client-tool messages → `appendToThreadContext`.
- `context_overwrites` — `approval_resolution` marker flushes → `overwriteThreadContext`
  (one per thread that resolved a pending call; may span thread ids for a policy fan-out).
- `mcp_patch` — full `MCPServerInitInfo` records for the policy-affected servers (merged
  `approval_policies` from the now-mutated tool sets) → `patchMCPServers`, so the sticky
  policy survives into future turns. The orchestrator supplies the full records from the
  `MCP_INITIALIZE` events it captures (needed because `patchMCPServers` replaces each
  server id wholesale).
- `echoes` — one `UserToolApprovalEvent` / `UserToolResponseEvent` /
  `UserToolApprovalPolicyEvent` per inbound user event → `appendToEvents` **and** returned
  to the stream.
- `consumed_event_ids` — the inbound events this commit applies; drives a mark-consumed
  write once the DB store + inbound inbox land (today a no-op: inbound events are not yet
  persisted at send).

Each field fires only if its array is non-empty (same `AGENT_CONTEXT_APPEND`-style
`output.length > 0` idiom already used across `persistExecutionEvent`). Acceptance ≠
coverage: an expired policy is still validated, applied, echoed, and persisted, but covers
nothing — so its commit carries no `approval_resolution` overwrite and the call stays
paused.

**Two producers, one event type, one commit per application step.** A thread assembles one
commit per decision-drain (single thread). The orchestrator assembles one commit per
policy apply: the policy is thread-less + session-wide, so application fans across every
live thread owning the server (resolve a pending call if matched, else only mutate the
tool set), but the orchestrator is the **sole** emitter — so the `echoes` + `mcp_patch`
fire exactly once even though `context_overwrites` may collect entries from several
threads. The commit is _plural_ (not one event per inbound event) because the
`approval_resolution` overwrite is a full-context write that must be coalesced to once per
drain; `echoes[]` / `consumed_event_ids[]` preserve per-inbound-event tracking inside it.
The transaction is scoped per application step, not per whole `send()` (thread drains and
policy application happen at different points in the execute loop).

**One stream echo per inbound user event, carrying its id.** Each incoming user event
yields exactly one entry in some commit's `echoes[]` on the SSE/redis stream (never a
flattened batch), so a consumer can later mark that specific inbound event consumed. The
echo uses the event form — `UserToolApprovalEvent` / `UserToolResponseEvent` /
`UserToolApprovalPolicyEvent`, which already carry an `id` — so no extra `event_id` is
added to the inbound message schemas. For policies, `send()` upgrades each inbound
`USER_TOOL_APPROVAL_POLICY` message to its event form right away (stamping `id` +
`created_at`) and enqueues the whole events (not flattened items) in `pendingPolicyEvents`;
`applyApprovalPolicies` flattens only to apply/patch the ToolSets, then carries each
original event into the commit's `echoes[]` so the stamped id survives to the stream.

**Unified with explicit approvals.** An explicit `USER_TOOL_APPROVAL` still appends its
decision message to context via `appendToContext` (unchanged) — that message remains the
execution input (`scanApprovalDecisions` → `callTool`: allow bypass / deny error+reason)
and the durable record. On top of that, applying an explicit decision also records the
**same decision object** on the call's `tool_info.approval` (allow _or_ deny), so
derivation keys off that one inline field for user decisions and policy alike. A `deny`
is therefore also "resolved" — `approval` is set, the call drops out of the pending set,
gets its deny tool-response, and closes; `callTool` still produces the
`"User denied: <reason>"` error from the decision message. The decision message and the
inline `approval` field coexist: the message is the execution input + durable record,
the field is the derivation projection.

**Matching is by name only — no per-call request-time anchor.** A policy means
"approve this tool before expiry". Any call that is _still pending_ was, by
definition, issued before a freshly-granted policy's expiry, so there is nothing to
compare a timestamp against — a live applicable policy for `(server, tool)` covers it
outright. "Applicable" is the same check `callTool` uses
(`hasApplicableApprovalPolicy` = policy exists && not expired at now).

Implemented as:

- `IToolSet.hasApplicableApprovalPolicy(toolName)` is now public (system tool sets
  return `false`). `InternalToolCallInfoSchema` gains `approval?: ApprovalDecision`
  (shared by explicit decisions and policy grants). `ApprovalDecisionSchema` lives in
  `LLMTypes` (re-exported from `events/schema`) so it can ride `tool_info` without a
  circular import.
- **The orchestrator applies policies; the thread resolves covered pending approvals.**
  `AgentThread.resolveApprovalsCoveredByPolicy()` allows each still-pending call whose tool
  set has an applicable policy (`toolSet.name` + `hasApplicableApprovalPolicy` on
  `tool_info.mcp_server_name` / `original_tool_name`) and returns whether any decision was
  recorded. The explicit-decision drain writes `tool_info.approval` on the matching call directly.
- **Enqueue in `send`, apply in `execute`.** `AgentThreadOrchestrator.send` _validates_
  policies via `validateApprovalPolicies` (unknown `server_name` → fail-closed, nothing
  enqueued) and queues them on `pendingPolicies`; it does not mutate ToolSets.
  `execute()`'s drain calls the private `applyApprovalPolicies` at the top of the loop,
  before computing `runnable`: per thread it records each matching policy on the ToolSets,
  then records an allow decision on every pending approval the policy now covers — so a
  landing policy flips its matching pending approvals to runnable that same iteration.

## Touch points

- `schema.ts`: `approval_policies` on `MCPServerInitInfoSchema`.
- Store: single writer `patchMCPServers` (entry carries `approval_policies`);
  `MCP_INITIALIZE` handler + `convertMCPServersToTools` carry policies through
  init — DONE.
- `SessionHandle` / orchestrator: accept + validate + persist the policy
  message; trigger re-eval.
- `ToolSet` (IMCP): policy-aware `is_approval_required`; `TurnResourceResolver`
  passes policies in — DONE.
- `AgentThread` derivation stays pure (context only) and the thread is policy-agnostic;
  the orchestrator enqueues policies in `send` and, in `execute`'s drain, applies them
  and records an allow decision on covered pending calls via `tool_info.approval` (the
  same inline field an explicit decision sets; name match, no anchor) — DONE.
