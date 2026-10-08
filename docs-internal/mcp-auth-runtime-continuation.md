# MCP auth in the in-memory turn executor

Status: implementation plan. Companion to `turn-runtime-executor.md`.

## 1. Goal

Support `mcp.auth_required` and `user.mcp_auth_continue` in the long-lived in-memory turn executor without stopping unrelated threads.

The desired behavior is:

- MCP auth blocks only the thread that encountered it.
- Runnable sibling threads continue.
- The turn becomes `paused` only when no active leaf thread can make progress.
- `user.mcp_auth_continue` resumes every thread currently waiting for MCP auth.
- Different threads may emit duplicate `mcp.auth_required` events for the same MCP server.
- The backend does not merge or deduplicate those events. The UI may deduplicate currently pending servers by MCP server id.
- Auth continuation resumes the same turn; it does not create a successor turn.

This iteration keeps the existing turn-scoped, unqualified `user.mcp_auth_continue` schema. Server-scoped continuation can be added later without changing the runtime model.

## 2. Decisions

### 2.1 Do not pause on the first auth requirement

An MCP auth requirement is a thread wait condition, not a turn-wide stop condition.

When one thread encounters auth:

1. That thread records that it is awaiting MCP auth.
2. It emits `internal.mcp.auth_required`.
3. Its `execute()` invocation returns.
4. The orchestrator excludes it from runnable leaves.
5. Sibling leaves continue normally.

The orchestrator emits a `paused` turn transition only after all active leaves are waiting for user input or MCP auth.

### 2.2 Allow duplicate auth-required events

Do not restore the old tail-level `mergeAuthEvents` behavior. There is no longer a finite tail at which all auth events can safely be merged because sibling generators may continue running.

Each blocked thread emits its own auth event. Therefore:

- Two threads blocked on the same server may produce two public `mcp.auth_required` events.
- One thread blocked repeatedly after unsuccessful continuation may produce another event for the same server.
- Event ids remain unique and each event is persisted in execution order.
- Internal `mcp_servers[].thread_ids` continues to identify the blocked thread for runtime routing; the public event remains run-scoped with `thread_id: null`.

UI deduplication must be stateful, not permanent:

- Deduplicate only the set of servers that are currently pending.
- `user.mcp_auth_continue` clears the current pending display.
- A later `mcp.auth_required` for the same server must be shown again because the retry may have discovered that authorization is still missing.

## 3. `AgentThread` auth wait state

MCP auth is different:

- It can occur during MCP initialization before a model tool call exists.
- It is server-scoped rather than tool-call-scoped.
- It is executor control state and must not be sent to the model.

MCP auth therefore gets dedicated state on `AgentThread`, separate from its LLM context:

```ts
private pendingMCPAuth = false;
```

Keep mutation inside the thread:

```ts
isRunnable(): boolean;
```

Auth-required paths set the flag. The orchestrator routes a persisted `USER_MCP_AUTH_CONTINUE` through `applyToThread()`; `AgentThread.send()` clears the flag.

No stage or server-id collection is needed for the current semantics:

- Continue is turn-scoped and resumes every auth-waiting thread.
- The backend does not deduplicate auth events.
- Initialization does not retain partial `convertedTools`, so it naturally retries after continue.
- Tool-execution auth retains `convertedTools` and naturally advances from persisted context.

The boolean is not a `ContextMessage` and is never included in the LLM request. It is, however, part of `AgentThreadSnapshot` so the wait survives executor reconstruction:

```ts
export interface AgentThreadSnapshot {
  // existing fields...
  pending_mcp_auth: boolean;
}
```

The constructor hydrates it, `toSnapshot()` returns it, and new threads default it to `false`.

This makes the auth wait reconstructible. It does not itself implement executor ownership transfer, automatic restart, or durable inbox replay; those remain part of the broader restart-recovery work.

### 3.1 Awaiting-input predicate

Extend the existing predicate:

```ts
isAwaitingUserInput(): boolean {
  return (
    this.isAwaitingMCPAuth() ||
    getPendingApprovalToolCalls(this.context).length > 0 ||
    getPendingClientSideToolCalls(this.context).length > 0
  );
}
```

Keeping one predicate lets the orchestrator use the same runnable-leaf rule for approvals, client responses, and MCP auth.

### 3.2 Recording the wait before rescheduling

The thread must be marked before the orchestrator next derives runnable leaves. Recording and persistence must remain within the per-turn transition lock so a concurrent continue cannot observe a half-applied auth transition.

For each auth exit:

- During `init()`, set `pending_mcp_auth`.
- During `stepToolResponse()`, set `pending_mcp_auth`.
- Emit the existing internal auth event and return from the thread execution.

There must be no point after the auth event is accepted where the thread can be selected again without a continue event.

The persisted flag must be set before the auth-required transition is considered committed. Clearing it must be committed with the applied continue before the thread becomes runnable.

## 4. Initialization versus tool-execution auth

The two auth sites resume differently.

### 4.1 Initialization auth

`convertMCPServersToTools()` currently returns a partial `convertedTools` value when one or more servers require auth. Committing that partial value would make the resumed thread skip initialization and permanently omit the newly authorized server.

Every `AgentThread`, including a dynamic subthread, calls `init()` when it executes. Dynamic subthreads normally inherit their parent's tool sets. Shared MCP implementations may return cached tools, so the main thread is the usual place preloaded-tool auth is first observed, but a child can still encounter initialization auth when it has child-specific resources or is reconstructed without in-memory caches. Therefore the pending flag belongs to every thread, not only the main thread.

Change initialization so `convertedTools` is committed only when there are no auth requirements:

```ts
const result = await convertMCPServersToTools(...);
if (result.authRequirementInfo.length === 0) {
  this.convertedTools = result.convertedTools;
}
return result;
```

After the continue clears the wait, the next `execute()` sees no `convertedTools`, reruns initialization, and includes the newly authorized server. Already initialized remote tool sources may use their existing connection/tool caches.

After reconstruction, `convertedTools` is also absent. A hydrated `pending_mcp_auth: true` keeps the thread blocked until continue is applied; the subsequent execution then reruns initialization.

If authorization is still missing, initialization records a fresh wait and emits another auth-required event.

### 4.2 Tool-execution auth

The current tool execution path appends a synthetic tool result for an auth-blocked call:

`Waiting for user to authenticate. Please try again 1 time.`

That closes the current model tool call. The continuation therefore does not directly replay the same tool call. It clears the thread's auth wait and lets the thread proceed to the next LLM call, where the model can retry.

Do not clear `convertedTools` for tool-execution auth. The existing mapping is needed and remains valid.

## 5. Orchestrator changes

### 5.1 Remove `authBlocked` from local executor state

The current `authBlocked: Set<string>` is local to `execute()`. That prevents `send()` from validating a continuation against the actual wait state.

The source of truth moves to each `AgentThread.pendingMCPAuth` boolean. The orchestrator no longer needs a separate blocked set:

```ts
const runnable = getActiveAgentThreads(agentThreads).filter(thread => !thread.isAwaitingUserInput());
```

This also avoids keeping thread and orchestrator block state synchronized.

### 5.2 Accepting `user.mcp_auth_continue`

Update `AgentThreadOrchestrator.send()` queueing:

- Queue every accepted continue event in arrival order.
- Keep all-or-nothing validation for a mixed submitted event batch.

The event remains turn-scoped and has no `thread_id` or server ids. It is queued without inspecting thread blocking state and clears the MCP-auth flag across the live thread snapshot when consumed.

### 5.3 Applying the continue

Handle `USER_MCP_AUTH_CONTINUE` while draining `pendingTurnEvents`:

1. Capture all live thread ids.
2. Emit an isolated `InternalMCPAuthContinueEvent` carrying the public event and thread ids.
3. `TurnHandle` patches `pending_mcp_auth: false` and persists the public event.
4. Route the continue through `applyToThread()` for each live thread after persistence succeeds.
5. Recompute runnable leaves.
6. Emit `running` only if at least one thread became runnable.

An accepted continue does not append anything to the LLM context.

### 5.4 Continue while siblings are running

The turn may still be `running` when auth continue arrives because another thread is active. In that case:

- apply and echo the continue;
- make auth-waiting threads eligible for the next runnable selection;
- wake the executor;
- do not emit a redundant `running` transition.

If the turn was parked, emit `running` after applying the continue and confirming that a leaf is runnable.

## 6. Ordering and concurrency

All auth transitions use the existing per-turn transition lock.

The following sequence must be atomic relative to another submitted event:

1. Validate that an auth wait exists.
2. Yield the accepted event for persistence.
3. Enqueue it in `pendingTurnEvents`.
4. Wake the executor.

Executor-side application must also be serialized with submissions:

1. Consume the queued continue.
2. Persist and emit the applied `user.mcp_auth_continue` together with clearing each affected thread's auth wait.
3. Clear the corresponding in-memory waits after the durable transition succeeds.
4. Recompute runnable leaves.

Drain the current `pendingTurnEvents` snapshot in arrival order; events submitted during application are handled on the next executor pass.

The latching wake requirement from `turn-runtime-executor.md` applies unchanged.

## 7. Turn and event semantics

### 7.1 Required auth event

Keep the existing public shape:

```ts
{
  type: 'mcp.auth_required',
  thread_id: null,
  mcp_servers: [...]
}
```

Do not add public thread ids solely for runtime routing.

### 7.2 Continue event

Keep the existing public shape:

```ts
{
  type: 'user.mcp_auth_continue';
}
```

The accepted event gets its id and timestamp at the HTTP boundary, is returned by `POST /events`, and is later persisted/emitted when the executor applies it.

### 7.3 Turn state

- Auth event while another leaf is runnable: turn remains `running`.
- All leaves blocked: transition to `paused`.
- Continue makes a parked leaf runnable: transition to `running`.
- Continue is accepted but auth immediately fails again: emit a new auth-required event and return to `paused`.
- Duplicate auth events from separate threads do not imply duplicate continue events; one continue resumes all currently waiting threads.

## 8. Failure behavior

- Continue with no pending auth is accepted and persisted as a no-op signal.
- Duplicate queued continues are persisted and echoed; after the first clears the flags, later ones are state no-ops.
- Persistence failure at the `send()` yield: generator is not resumed, event is not queued, waits remain unchanged.
- Persistence failure while setting or clearing `pending_mcp_auth` prevents the corresponding in-memory transition.
- Continue followed by another auth-required result: persist the fresh required event and keep that thread blocked.
- One resumed thread errors: normal thread/root error handling applies; it must not re-block unrelated threads.
- Abort while parked on auth: latching wake releases the executor and normal abort handling terminates the turn.

## 9. Persistence and restart recovery

Add `pending_mcp_auth` to `AgentThreadSnapshot` and to each store's thread representation. Update:

- `AgentThread` construction and `toSnapshot()`;
- `ISessionStore` thread initialization and patch types;
- in-memory, SQLite, and Postgres stores;
- SQLite and Postgres migrations/types as required;
- store contract fixtures and assertions.

Use `patchThreadsMCPAuth` to update thread flags, followed by the standard `appendToEvents` path for the public event. This intentionally follows the existing sequential persistence model used by other compound runtime events. A future store-wide transaction API should make all such compound commits atomic together rather than introducing MCP-specific transactional methods.

On reconstruction:

1. Hydrate `pending_mcp_auth` into each `AgentThread`.
2. Exclude hydrated waiting threads from runnable leaves.
3. Keep the turn paused if no other leaf is runnable.
4. Accept a later continue against the hydrated state.
5. Clear the durable flags and resume those same thread instances.

Automatic process restart, executor ownership acquisition, and inbound-event replay are outside this plan. The snapshot change ensures that when an executor is rebuilt, it does not incorrectly run an auth-blocked thread.

## 10. Tests to add

### 10.1 `AgentThread` tests

1. Initialization auth marks the thread awaiting MCP auth.
2. Initialization auth does not commit partial `convertedTools`.
3. Continue after initialization auth reruns MCP initialization.
4. Successful retry includes tools from the newly authorized server.
5. Failed retry emits a fresh auth-required event and blocks again.
6. Tool-execution auth preserves `convertedTools`.
7. Tool-execution continue advances to the next LLM call.
8. MCP auth state is not included in model context.
9. `toSnapshot()` includes `pending_mcp_auth`.
10. Constructing from a snapshot hydrates the pending flag.
11. A reconstructed auth-waiting thread does not execute before continue.
12. A dynamic subthread can independently enter initialization auth.

### 10.2 Orchestrator tests

1. One child requires MCP auth while a sibling continues to completion.
2. The turn does not pause until every active leaf is blocked.
3. Two threads requiring the same server emit two auth-required events.
4. A single continue resumes both waiting threads.
5. Threads waiting on different servers are all resumed by the generic continue.
6. Continue while siblings are still running does not emit a redundant running transition.
7. Continue from a parked turn emits paused-to-running in order.
8. Continue with no pending MCP auth is queued and applied as a no-op.
9. Two concurrent continue requests both succeed and produce two applied continue events.
10. A resumed thread that still lacks auth emits a fresh event and blocks again.
11. Approval-waiting threads are not resumed by MCP auth continue.
12. MCP-auth-waiting threads are not resumed by approval or tool-response events.
13. A reconstructed child waiting on auth does not prevent a runnable sibling from continuing.

### 10.3 Session/turn integration tests

1. `POST /events` accepts `user.mcp_auth_continue` for a live auth-paused turn.
2. The accepted continue uses the same `turn_id`.
3. The applied continue is persisted and appears in SSE/list-events before subsequent model output.
4. Invalid continue returns 4xx and leaves the turn paused.
5. Persist failure before enqueue leaves all threads blocked.
6. Auth-required, paused, continue, running, and repeated-auth ordering is stable.
7. Cancelling an auth-paused turn releases the parked executor and persists the terminal state.
8. Persisting auth-required patches the thread flag and stores the event.
9. Persisting continue clears thread flags and stores the event.
10. Reloading a paused turn preserves auth-waiting threads.

### 10.4 Store contract tests

1. New threads default `pending_mcp_auth` to `false`.
2. Thread snapshots round-trip both boolean values.
3. Auth state supports `false → true` and `true → false` patches.
4. Multi-thread auth-state patches update every supplied thread.
5. Unknown thread ids reject the whole transition.
6. Terminal turns reject auth-state mutation.

### 10.5 Local API script

`scripts/test-turn-events-api.mjs` covers:

1. Two continue events are accepted and echoed without resolving an approval-blocked thread.
2. With `TRUEFORGE_TEST_MCP_AUTH_REQUIRED=1`, an unauthenticated preloaded server emits auth-required, accepts continue on the same turn, retries initialization, and emits auth-required again.
