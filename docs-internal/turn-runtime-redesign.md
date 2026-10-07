# Durable turn runtime redesign — simplified

Status: proposed low-level design. Companion to `turn-plan.md` and `turn-steal.md`.

## 1. Decision

The target runtime has three domain layers plus one process-local registry:

1. `TurnHandle` — durable execution host for one turn.
2. `AgentThreadOrchestrator` — turn-level decision machine across all threads.
3. `AgentThread` — one LLM/tool state machine and its context.
4. `ActiveTurnRegistry` — keeps hot `TurnHandle`s addressable in this process and controls activation/offload locking, keepalive, cancellation, and shutdown.

`ISessionStore` remains the persistence dependency. It is not another runtime object.

The orchestrator remains, but becomes narrower. It decides what should happen across threads; `TurnHandle` makes those decisions durable and dispatches the resulting work.

```text
HTTP / peer request
        |
        v
ActiveTurnRegistry  -- lookup / lock / rebuild / offload
        |
        v
TurnHandle          -- serialized transitions + execution pumping
        |
        v
AgentThreadOrchestrator -- thread graph + turn decisions
        |
        +---- AgentThread(main)
        +---- AgentThread(child A)
        +---- AgentThread(child B)
        |
        v
ISessionStore       -- atomic checkpoint + events + inbox
```

The client never calls `resume`. An inbound submission is routed to `TurnHandle`; the orchestrator validates it and decides whether to apply or queue it, and `TurnHandle` persists and dispatches that transition.

## 2. Current implementation reference

### 2.1 Current call path

```text
SessionHandle.createTurn()
  -> build AgentThreads
  -> AgentThreadOrchestrator.send(initial input)
  -> persist running turn
  -> return TurnHandle

TurnHandle.stream()
  -> append turn.created
  -> AgentThreadOrchestrator.execute()
  -> persist every yielded event
  -> write terminal state in finally
  -> close resources
```

`TurnHandle.stream()` is simultaneously:

- the execution driver,
- the durability boundary,
- the client event source,
- the terminal-state writer,
- and the resource lifetime.

Therefore ending a stream also ends the executable object. A later request cannot address the same turn.

### 2.2 Current thread execution

`AgentThread` already has the right local responsibility. Its state is:

```text
llm-call-required
tool-response-required
user-input-required
```

But `send()` and `execute()` are mutually exclusive through `contextBusy`. There is no safe point where an inbound event can be accepted while another thread is running.

The existing run-until-blocked LLM → tools → HITL/done loop remains the local thread execution model. Context append/overwrite helpers yield their durable event before mutating the thread's in-memory context, allowing the caller to persist the event before advancing the generator. Model deltas stream as they arrive, while complete messages and context changes are durable.

### 2.3 Current parent/child behavior

These semantics are already correct and must be preserved:

- A dynamic child stores the existing `parent` reference containing the parent thread ID and parent tool-call ID.
- Creating a child emits `thread.created`, adds the child to the orchestrator's thread map, and makes the parent non-leaf while that child exists.
- On child completion, the orchestrator checks `parent.hasOpenToolCallId(parent.tool_call_id)`.
- If the parent call is still open, the child result is delivered to the parent as its tool response.
- The completion event is emitted, the child's metrics move into the finished-sub-agent aggregate, and the completed child is removed.
- The open-tool-call guard prevents delivery after the parent call has resolved, and removing the completed child prevents a second normal completion.

The redesign changes scheduling and durability around these operations, not these parent/child semantics.

### 2.4 Current multi-thread execution

`AgentThreadOrchestrator` computes leaf threads and merges up to five async generators.

The first HITL event sets a turn-wide stop flag. Generators already in the current merged batch can drain, but later batches and scheduling rounds do not run. Whether a sibling progresses therefore depends on batching, not its own state.

Approval input is also validated against all threads. If two threads are waiting, resolving one causes the other to validate an empty batch and reject it.

### 2.5 Current resource lifetime

`SessionHandle.createTurn()` owns the `TurnResourceResolver` while constructing a turn. On success, ownership passes to `TurnHandle.stream()`, whose terminal/error cleanup closes it. Consequently, resource lifetime is currently tied to the one-shot stream lifetime.

The resolver remains the owner of turn-scoped sandbox, MCP, model, logging, and tracing resources; the redesign does not introduce another resource-scope abstraction.

### 2.6 Current durability gaps

Useful foundations already exist:

- thread/context snapshots,
- append-only context storage,
- persisted turn events,
- running-state write fences,
- `active_executor_id`,
- `ActiveTurnRegistry`,
- an inbound event table,
- and the `paused` wire schema.

Missing behavior:

- runtime still writes `done + required_actions`, not `paused`;
- inbound events are not applied;
- `TurnHandle.stream()` is single-use;
- there is no executable rebuild from a `TurnRecord`;
- progress writes are not fenced by the full generated `active_executor_id`;
- one logical transition uses several store calls rather than one transaction;
- and Redis can lag Postgres after the current dual write.

## 3. High-level design

### 3.1 Responsibility split

`TurnHandle` is the durable execution host. Its public methods and thread-run callbacks use one per-turn transition lock, ask the orchestrator for decisions, commit those decisions atomically, and dispatch the resulting LLM/tool work. It owns process-level concerns such as resources, cancellation, pause keepalive, and offload. It does not interpret parent/child relationships or tool approvals.

`AgentThreadOrchestrator` is the turn-level decision machine. It owns the set of `AgentThread`s and one accepted-event queue, and understands parent/child relationships, required actions, inbound routing, runnable leaves, child-result routing, and turn-state derivation. It answers “what should happen next?” It does not know about Postgres, Redis, HTTP, SSE, executor ownership, or process shutdown.

`AgentThread` is the local LLM/tool state machine. It understands one thread's context and how that context moves through model calls, tools, client input, and completion. It does not know about sibling scheduling or turn durability.

`ActiveTurnRegistry` is process-local infrastructure. It makes hot handles addressable, serializes activation/offload races, retains paused handles for a grace period, and rebuilds a paused handle when needed.

The registry's activation lock and the handle's transition lock have different scopes. The registry prevents two handles from being activated/offloaded concurrently; the handle serializes state transitions after one active handle has been selected.

The rule of thumb is:

- “What should happen next?” belongs to the orchestrator.
- “How is that decision owned, persisted, dispatched, and recovered?” belongs to `TurnHandle`.

### 3.2 Durable-workflow analogy

The closest Temporal-style mapping is:

- `ISessionStore` resembles the durable workflow history/checkpoint service.
- `ActiveTurnRegistry` resembles sticky workflow-worker routing and cache.
- `TurnHandle` resembles the workflow-task runtime: receive an event, run a decision, commit commands, and dispatch external work.
- `AgentThreadOrchestrator` resembles workflow code/the workflow decision machine.
- LLM and tool calls resemble Activities.
- Sub-agents resemble child state machines inside the same workflow execution.

The analogy is not exact because Temporal's service owns more of the commit protocol. In TrueForge, `TurnHandle` combines the worker-side runtime with the adapter that commits decisions to `ISessionStore`.

### 3.3 One transition

```text
external event or thread execution event/completion
  -> corresponding TurnHandle method
  -> acquire the per-turn transition lock
  -> AgentThreadOrchestrator evaluates the committed thread state and accepted-event queue
  -> Orchestrator computes a transition:
       thread/context changes
       next turn state
       public events
       thread runs to start
  -> TurnHandle atomically persists the transition
  -> TurnHandle applies the transition's next orchestrator snapshot
  -> TurnHandle starts the selected thread runs
  -> yielded execution events and run completions call TurnHandle directly
```

The orchestrator never mutates current state while computing a transition. `TurnHandle` never independently reinterprets thread state.

### 3.4 Approval

```text
POST approval for child A
  -> request is routed to the owning TurnHandle
  -> TurnHandle.submitInbound() acquires the transition lock
  -> orchestrator:
       validates the approval against child A's committed required actions
       adds the durable approval event to its accepted-event queue, targeted to child A
       changes child A from waiting to ready-to-run
       leaves child B unchanged
       derives paused -> running when work is now available
       selects child A to run
       includes the accepted inbox event as pending in the transition delta
  -> TurnHandle atomically commits pending inbox event + thread change + turn.update(running)
  -> HTTP returns success
  -> TurnHandle starts child A.execute()
  -> child A.execute() receives and applies its pending approval first:
       yields one append-context event whose public output contains user.tool_approval
  -> TurnHandle commits context append + public event + inbox applied
  -> the same execute() run continues into tool execution
```

The HTTP response waits for orchestrator validation and durable queueing. It does not wait for `execute()` to stream/apply the event or finish later tool/LLM work.

### 3.5 One child waits while another continues

```text
child A reports tool.approval_required
  -> orchestrator marks A waiting
  -> child B remains runnable/running
  -> orchestrator derives turn = running

child B finishes
  -> orchestrator routes B's result to the parent
  -> A is now the only unfinished leaf and is waiting
  -> orchestrator derives turn = paused
```

HITL blocks one thread. It does not produce a turn-wide stop signal.

### 3.6 Pause, offload, and inbound submission

```text
orchestrator derives paused
  -> TurnHandle commits paused
  -> ActiveTurnRegistry keeps the handle hot for a grace period

event arrives during grace
  -> request is submitted to the existing TurnHandle

grace expires
  -> registry offloads the handle and closes resources

later event arrives
  -> paused owner rebuilds, or another executor wins ownership CAS
  -> rebuilt TurnHandle restores the orchestrator snapshot
  -> request is validated and committed normally
```

No generator stack is serialized. The durable state is the orchestrator's thread snapshot plus the turn checkpoint.

### 3.7 Keep supporting state as data

Do not add standalone runtime services for the thread graph, waits, effects, event queue, or transitions. Parent links, thread status, required actions, run IDs, and accepted inbound events remain serializable orchestrator data, persisted through the existing checkpoint and inbox storage.

## 4. State semantics

### 4.1 Thread status

The orchestrator persists coarse scheduling state around each `AgentThreadSnapshot`:

```ts
type ThreadStatus =
  | { kind: 'ready' }
  | { kind: 'running'; run_id: string }
  | { kind: 'waiting'; required_actions: ActionRequiredEvent[] }
  | { kind: 'waiting_children'; child_thread_ids: string[] }
  | { kind: 'done'; output: ModelMessageEvent }
  | { kind: 'error'; message: string }
  | { kind: 'cancelled' };

interface OrchestratedThread {
  snapshot: AgentThreadSnapshot;
  status: ThreadStatus;
}

interface OrchestratorRuntimeState {
  threads: Map<ThreadId, OrchestratedThread>;
  pending_inbound: TurnInboundEvent[];
}
```

The new coarse status stores full required-action events with the waiting thread, including their type, owning thread, and tool-call references. Accepted approvals/responses are placed in one orchestrator-owned `pending_inbound` queue and make their target thread `ready`; they do not mutate context during submission. Each event already identifies its target thread, so a map by thread ID may be maintained as an in-memory index but is not a second source of state.

The queue is in memory while hot and is reconstructed from pending inbox rows after rebuild, so the thread checkpoint does not duplicate event payloads. `TurnStatePaused.action_required_on_events` remains the smaller public list of event IDs. No separate durable `Wait` object is required in v1.

### 4.2 Turn state is derived

```ts
class AgentThreadOrchestrator {
  deriveTurnState(): TurnState {
    const root = this.findRoot();

    if (root.status.kind === 'error') {
      return turnError(root.status.message);
    }

    if (root.status.kind === 'done' && this.requiredChildrenAreFinished()) {
      return turnDone(root.status.output);
    }

    if (this.someThread(t => t.status.kind === 'ready' || t.status.kind === 'running')) {
      return { status: 'running' };
    }

    const required = [...this.threads.values()].flatMap(thread =>
      thread.status.kind === 'waiting' ? thread.status.required_actions : [],
    );

    if (required.length > 0) {
      return {
        status: 'paused',
        action_required_on_events: required.map(action => ({
          id: action.id,
        })),
      };
    }

    throw new InvariantError('non-terminal turn has no ready, running, or HITL thread');
  }
}
```

Consequences:

- One waiting thread plus one ready/running sibling means the turn is `running`.
- The turn is `paused` only when all unfinished leaves need external input.
- Resolving one action can make one thread runnable while other threads remain waiting; the turn changes to `running`.
- Resolving an action that does not make any thread runnable leaves the turn `paused` with fewer required actions.

### 4.3 Scheduling

The orchestrator selects work; `TurnHandle` supplies available process capacity:

```ts
class AgentThreadOrchestrator {
  nextRuns(capacity: number): ThreadRun[] {
    if (capacity <= 0) return [];

    return this.getRunnableLeaves()
      .slice(0, capacity)
      .map(thread => ({
        thread_id: thread.threadId,
        run_id: newRunId(),
        inbound_events: this.pendingInboundFor(thread.threadId),
      }));
  }
}
```

`TurnHandle` persists the selected thread as running, then starts that thread's existing `execute()` generator with the selected `inbound_events`. The events remain in the orchestrator queue until their context/public-event transition commits. Each thread is pumped independently; there is no merged turn-wide generator:

```ts
private startRun(run: ThreadRun): void {
  assert(this.orchestrator.isCurrentRun(run));

  const controller = new AbortController();
  this.inFlight.set(run.run_id, controller);

  void this.pumpThreadRun(run, controller.signal)
    .then(result => this.onThreadRunFinished(result))
    .catch(error =>
      this.onThreadRunFailed({
        thread_id: run.thread_id,
        run_id: run.run_id,
        error: describeUnknownError(error),
      }),
    )
    .finally(() => this.inFlight.delete(run.run_id));
}
```

`pumpThreadRun()` publishes model deltas immediately. For every durable event yielded by `execute()`, it awaits `onThreadEvent()`; that method acquires the transition lock and commits before the generator's next item is requested. This preserves the existing generator's store-before-next-mutation ordering while allowing inbound requests and sibling executions to remain concurrent outside short transition critical sections.

### 4.4 Inbound events while running

An inbound request calls the owning `TurnHandle` and waits for its serialized transition result; it is not a notification that follows an unconditional inbox insert. There are four milestones:

1. **Routed** — the request reached the owning `TurnHandle`.
2. **Validated** — the orchestrator matched every event to the targeted thread's committed required actions.
3. **Committed** — accepted events were durably stored as pending and placed in the orchestrator's in-memory queue with their target thread IDs.
4. **Applied** — that thread's next `execute()` run streamed the event, appended its context representation, and marked the inbox row applied.

A successful `POST events` covers routed + validated + committed. An invalid event returns `4xx` and is not inserted into the inbox. Success does not wait for `execute()` to stream/apply the event or for subsequent LLM/tool work.

```text
POST events
  -> authenticate
  -> validate payload shape and target turn id
  -> resolve active_executor_id and turn state
  -> owner is another executor:
       forward the full submit request and await its result
  -> owner is this executor and handle is live:
       await handle.submitInbound(events)
  -> owner is this executor, no handle, and turn is paused:
       rotate active_executor_id by CAS, rebuild, then await submitInbound(events)
  -> owner is unavailable and turn is paused:
       replace active_executor_id by CAS, rebuild, then await submitInbound(events)
  -> return the owner's committed result
```

The owning `TurnHandle.submitInbound()` uses the same transition lock as thread execution events and completions. `AgentThreadOrchestrator.computeInboundTransition()` performs semantic validation against the current committed snapshot.

If validation fails, `submitInbound()` rejects with a typed validation error and HTTP returns `4xx`. No transition is committed. If an approval/response batch is valid, its transition:

- inserts each inbox row as pending;
- adds each event to the orchestrator's `pending_inbound` queue;
- changes that thread from `waiting` to `ready`; and
- selects a new coarse thread run when capacity is available.

The queue is orchestrator-owned state, not a separate runtime service and not mutable state inside `AgentThread`. Durably, it is reconstructed from pending inbox rows. When scheduling a run, the orchestrator copies only that thread's applicable events into `ThreadRun.inbound_events`; the authoritative queue entries remain until application commits. Context is unchanged until `AgentThread.execute()` applies those supplied events.

A tool approval with no matching committed approval requirement is invalid, not queueable; the queue cannot pre-authorize a future tool call.

The transition—not the HTTP handler—describes the inbox write:

```ts
async submitInbound(events: TurnInboundEvent[]): Promise<InboundSubmissionResult> {
  return this.transitionLock.runExclusive(async () => {
    const transition = this.orchestrator.computeInboundTransition({
      events,
      capacity: this.availableCapacity(),
    });

    await this.commitAndApply(transition);
    return transition.inbound_result;
  });
}
```

Rules:

- Inbox insertion and application are owner-fenced parts of `commitTurnTransition()`; the HTTP handler does not write the inbox directly.
- HTTP success requires the owner to validate and commit the orchestrator's transition.
- A batch is atomic: if any submitted event is invalid, the request returns `4xx` and none of its events are inserted.
- The HTTP layer validates authentication, event schema, and the target turn. It does not decide whether a tool call currently needs approval.
- During `computeInboundTransition()`, the orchestrator locates the targeted thread and asks that thread's local validation logic to match the inbound event against its committed `required_actions` and context.
- An approval is valid only when the thread is waiting on a `tool.approval_required` action containing the same `tool_call_id`, and the underlying tool call is still open and marked approval-required. Client-tool responses and MCP-auth continuation follow the equivalent type-specific checks.
- An event with no matching currently committed required action—including an already-resolved action—is rejected before inbox insertion.
- A batch may resolve selected waiting threads while other threads remain waiting. For v1, a targeted thread still receives all of its currently pending approval/client-response actions as one unit, preserving today's within-thread validation.
- Clients send an approval/response only after receiving its committed required-action event; an approval cannot pre-authorize a future tool call.
- Submission never mutates context. Only the targeted thread's subsequent `execute()` run applies the events supplied to that run.
- Approval policy and MCP-auth events follow the same inbox path.
- Generic user steering is not enabled until queue-at-safe-point versus interrupt semantics are specified.

If a running owner cannot be reached, another replica must not start the turn: an LLM/tool call may still be in flight. Return unavailable without inserting an inbox row. Likewise, if this executor owns a `running` row but has no live handle, fail closed rather than rebuilding it. If a paused ownership claim loses a race, re-read the owner and forward the request there.

There is no request idempotency key in this iteration. If the owner commits but the response is lost, a client retry can submit a duplicate. The orchestrator rejects an approval for an already-resolved action, so it cannot run the tool twice.

The assistant context, its required action, and the thread's `waiting` status must commit atomically. The system cannot expose a committed tool call without the matching durable HITL state.

### 4.5 Stream accepted input through `AgentThread.execute()`

`send()` must not privately apply approval/response context before execution, because those user events would bypass the normal persisted event stream. Instead, the orchestrator queues accepted durable event objects—including `id`, `created_at`, and target thread—and supplies the applicable events to the target thread's next run. `execute()` applies them before deriving the normal LLM/tool state:

```ts
private *applyInbound(
  events: TurnInboundEvent[],
): Generator<AgentThreadAppendContext> {
  for (const event of events) {
    yield {
      type: InternalEventType.AGENT_CONTEXT_APPEND,
      thread_id: this.threadId,
      context: contextMessagesFor(event),
      public_events: [event],
      applied_inbound_event_ids: [event.id],
    };
  }
}

public async *execute(options: {
  signal: AbortSignal;
  inbound_events: TurnInboundEvent[];
}): AsyncGenerator<AgentThreadEvent, ThreadRunResult> {
  yield* this.applyInbound(options.inbound_events);

  // Existing initialize -> LLM -> tools -> HITL/done loop remains.
  return yield* this.executeUntilBlocked(options);
}
```

The orchestrator removes each event from `pending_inbound` in the same committed transition that appends its context representation, publishes its public event, and marks its inbox row applied. Only then does `TurnHandle` advance the generator. `AgentThread` therefore consumes run input but does not own an inbound queue.

`public_events` is intentionally broader than the current `AgentThreadAppendContext.output: AgentOutputEvent[]`: approval/response events are user input, not agent output. The internal durable-change type should gain a `public_events: PersistedTurnEvent[]` field (or rename/widen the existing field) so `TurnHandle` can persist and publish both directions without misclassifying the event.

`TurnHandle` handles the yielded append as one transition:

1. append the approval/response representation to thread context;
2. append the public `user.tool_approval` / `user.tool_response` event;
3. mark the corresponding inbox row applied;
4. update thread status; and
5. publish the committed public event to the existing event-subscription stream.

The generator is not advanced again until that transition commits. Therefore the event is visible through create SSE or later `subscribe`, and the tool/LLM continuation cannot run before its input event and context are durable. If no SSE client is connected, execution still commits the event; a later subscription reads it normally.

## 5. Durability

### 5.1 One atomic turn commit

Add one operation to the existing store rather than creating another repository layer:

```ts
interface ISessionStore {
  // Existing methods omitted.

  commitTurnTransition(input: {
    session_id: string;
    turn_id: string;
    active_executor_id: ActiveExecutorId;
    thread_changes: ThreadChange[];
    removed_thread_ids: string[];
    inbound_changes: InboundEventChange[];
    output_events: PersistedTurnEvent[];
    state: TurnState;
    metrics_delta: AgentThreadMetrics;
  }): Promise<void>;
}
```

The transaction:

1. checks the exact `active_executor_id` token and non-terminal state;
2. updates thread snapshots/context/capability state;
3. inserts newly accepted inbox rows and updates queued rows to applied/rejected;
4. appends public events;
5. updates metrics and turn state.

Only after this succeeds does `TurnHandle` apply the transition's next snapshot to the orchestrator's in-memory state.

Fine-grained store methods may remain for create/import/read paths. Runtime progress uses `commitTurnTransition()` so a logical transition cannot be partially persisted.

`commitTurnTransition()` itself requires no new relational schema columns; it is a transaction over the existing turn, thread/context, event, metric, and inbox storage. `active_executor_id` remains the only relational ownership fence: do not add owner-generation or checkpoint-version columns. No idempotency-key column or uniqueness constraint is added in this iteration.

The serialized thread checkpoint must gain coarse thread status, open required actions, and current run identity needed for fencing stale completions. The inbox can initially retain `consumed`, although explicit applied/rejected/discarded status or timestamps would make operations clearer later.

### 5.2 Ownership

`active_executor_id` is the complete fencing token:

```ts
type ActiveExecutorId = string; // `${executorId}.${generation}`
```

`generation` is a random four-character alphanumeric string, not a counter. For example:

```text
executor-abc.X7k2
```

The executor prefix is used for peer routing. Progress writes compare the complete value, so a stale handle from an earlier generation on the same executor cannot commit.

Every runtime commit uses:

```sql
WHERE session_id = :session_id
  AND turn_id = :turn_id
  AND active_executor_id = :active_executor_id
  AND state->>'status' IN ('running', 'paused')
```

Inbox insertion is part of the owner's fenced turn commit. A non-owner forwards the full request to the owner; it does not insert first. For an offloaded paused turn, a replica must claim/rebuild the turn before asking the orchestrator to validate and commit the event.

Cancel is not owner-fenced. It conditionally changes `running|paused` to `cancelled`, making later owner commits fail.

Creating a turn mints its first token. Rebuilding an offloaded paused turn—even on the same executor—mints a fresh token and atomically replaces the previous `active_executor_id` before the handle starts. Waking an already-live handle keeps its current token. There are no separate owner-generation or checkpoint-version columns.

The per-turn transition lock serializes commits within one handle; the generated ownership token fences stale handles. Therefore a separate checkpoint version is not required.

### 5.3 Pause and resume

Pause is not terminal:

```text
some threads waiting + any thread runnable/in-flight -> running
all unfinished leaves waiting for external input     -> paused
root complete                                        -> done
```

On transition to paused:

- persist `TurnStatePaused`;
- append `turn.update(paused)`;
- keep the handle hot for a short TTL;
- do not emit `turn.done`;
- do not close merely because an SSE request ended.

On the last relevant approval/tool response:

- insert the accepted inbox row as pending;
- add the durable event to the orchestrator's in-memory queue with its target thread ID;
- update the targeted thread from `waiting` to `ready`;
- persist `turn.update(running)`;
- schedule the next thread run automatically;
- let `execute()` stream/apply the event and mark the inbox row applied before continuing;
- keep the same `turn_id`.

### 5.4 Offload and rebuild

Only a quiescent paused turn can be offloaded or stolen in v1.

Before this rebuild function runs, the registry must have replaced the prior `active_executor_id` by CAS and re-read the claimed turn record. The new handle receives that claimed token through `record`.

```ts
private async rebuildPausedTurn(record: TurnRecord): Promise<TurnHandle> {
  assert(record.state.status === 'paused');

  const resources = await resolveTurnResources(record.snapshot);
  const threads = buildAgentThreads(record.snapshot, resources);
  const pendingInbound = await store.listPendingInbound(record.id);
  const orchestrator = new AgentThreadOrchestrator({ threads, pendingInbound });
  const handle = new TurnHandle({
    record,
    orchestrator,
    resources,
    store,
  });

  handle.start();
  return handle;
}
```

Rebuild does not restore a generator stack. It restores the orchestrator's thread status/context snapshot, reconstructs its single pending queue from pending inbox rows, and asks the handle to schedule available work.

Because paused implies no running thread execution, rebuilding cannot duplicate an LLM/tool call.

Running-turn crash recovery is explicitly out of scope for v1. A running turn whose owner dies is cancelled/abandoned rather than stolen.

### 5.5 Resource lifetime

Change resource ownership from stream-scoped to active-`TurnHandle`-scoped. After turn construction transfers the resolver to the handle:

- the resolver remains open when create/SSE disconnects;
- it remains open during paused keepalive;
- closed on offload, cancellation, terminal state, or shutdown;
- a rebuilt paused handle creates a new resolver from durable sandbox/MCP identity.

### 5.6 Client event delivery

Execution does not depend on an SSE consumer.

After `commitTurnTransition()` succeeds, `TurnHandle` puts committed public events—including `user.tool_approval` and `user.tool_response` yielded while draining thread input—into the existing event-subscription stream. If the process dies between the Postgres commit and Redis write, subscribe backfills missing events from Postgres.

Subscribe is read-only. It never rebuilds or steals a turn. Sending an event or another control operation submits a command to the owner.

An outbox can be added later if backfill proves insufficient; it is not required as a first-class runtime concept.

## 6. Detailed interfaces and transition handling

### 6.1 Interface sketches

These are directional APIs, not final TypeScript signatures.

```ts
interface TurnTransition {
  next_snapshot: AgentThreadOrchestratorSnapshot;
  delta: TurnDelta;
  runs_to_start: ThreadRun[];
  inbound_result?: InboundSubmissionResult;
}

interface ThreadRun {
  thread_id: string;
  run_id: string;
  inbound_events: TurnInboundEvent[];
}

class AgentThreadOrchestrator {
  computeStartTransition(input: {
    capacity: number;
  }): TurnTransition;

  computeInboundTransition(input: {
    events: TurnInboundEvent[];
    capacity: number;
  }): TurnTransition;

  computeThreadEventTransition(input: {
    thread_id: string;
    run_id: string;
    event: AgentThreadEvent;
    capacity: number;
  }): TurnTransition;

  computeRunFinishedTransition(input: {
    result: ThreadRunResult;
    capacity: number;
  }): TurnTransition;

  computeRunFailedTransition(input: {
    thread_id: string;
    run_id: string;
    error: string;
    capacity: number;
  }): TurnTransition;

  executeThread(
    run: ThreadRun,
    signal: AbortSignal,
  ): AsyncGenerator<AgentThreadEvent, ThreadRunResult>;

  applySnapshot(snapshot: AgentThreadOrchestratorSnapshot): void;
  toSnapshot(): AgentThreadOrchestratorSnapshot;
}

class AgentThread {
  readonly threadId: string;
  readonly parent?: AgentParent;

  execute(options: {
    signal: AbortSignal;
    inbound_events: TurnInboundEvent[];
  }): AsyncGenerator<AgentThreadEvent, ThreadRunResult>;
  toSnapshot(): AgentThreadSnapshot;
}

class TurnHandle {
  start(): Promise<void>;
  submitInbound(events: TurnInboundEvent[]): Promise<InboundSubmissionResult>;
  cancel(reason: CancellationReason): void;
  offload(): Promise<void>;

  private commitAndApply(transition: TurnTransition): Promise<void>;
  private onThreadEvent(run: ThreadRun, event: AgentThreadEvent): Promise<void>;
  private onThreadRunFinished(result: ThreadRunResult): Promise<void>;
  private onThreadRunFailed(failure: ThreadRunFailure): Promise<void>;
  private startRun(run: ThreadRun): void;
  private pumpThreadRun(run: ThreadRun, signal: AbortSignal): Promise<ThreadRunResult>;
}

class ActiveTurnRegistry {
  get(sessionId: string, turnId: string): TurnHandle | undefined;
  withActivationLock<T>(sessionId: string, turnId: string, fn: () => Promise<T>): Promise<T>;
  ensureActive(input: TurnActivationInput): Promise<TurnHandle>;
  submitInbound(sessionId: string, turnId: string, events: TurnInboundEvent[]): Promise<InboundSubmissionResult>;
  offload(sessionId: string, turnId: string): Promise<void>;
  cancelIfActive(...): boolean;
  shutdownAndWait(...): Promise<void>;
}
```

The orchestrator owns the current in-memory thread state and one pending-event queue. Events carry their target thread IDs; a per-thread lookup is only an implementation index. Each `compute*Transition()` method builds `next_snapshot` without replacing current state. For an approval/response submission, `computeInboundTransition()` either throws a typed validation error or returns a transition that queues the accepted events and reports them as queued. `applySnapshot()` replaces the in-memory state only after `ISessionStore.commitTurnTransition()` succeeds.

Naming is intentional: `compute*Transition()` methods are pure, `commit` refers only to the durable store transaction, `applySnapshot()` changes only in-memory orchestrator state, and `toSnapshot()` serializes current state.

`AgentThreadOrchestrator.executeThread()` only locates the target thread and delegates to its existing run-until-blocked `AgentThread.execute()`, passing `run.inbound_events`. It does not choose new work or persist yielded events. `TurnHandle.startRun()` owns the asynchronous lifecycle: it supplies cancellation, tracks the in-flight generator, and pumps its output.

For each durable yielded event, `pumpThreadRun()` awaits `onThreadEvent()` before advancing the generator. Model deltas remain ephemeral and publish immediately. Run-finished/failed callbacks carry `run_id`, so a late result from an obsolete run is rejected.

### 6.2 Serialized transition handling

```ts
class TurnHandle {
  private readonly transitionLock = new AsyncMutex();

  async start(): Promise<void> {
    await this.transitionLock.runExclusive(async () => {
      const transition = this.orchestrator.computeStartTransition({
        capacity: this.availableCapacity(),
      });
      await this.commitAndApply(transition);
    });
  }

  async submitInbound(events: TurnInboundEvent[]): Promise<InboundSubmissionResult> {
    return this.transitionLock.runExclusive(async () => {
      const transition = this.orchestrator.computeInboundTransition({
        events,
        capacity: this.availableCapacity(),
      });
      await this.commitAndApply(transition);
      return transition.inbound_result!;
    });
  }

  private async onThreadEvent(run: ThreadRun, event: AgentThreadEvent): Promise<void> {
    await this.transitionLock.runExclusive(async () => {
      const transition = this.orchestrator.computeThreadEventTransition({
        thread_id: run.thread_id,
        run_id: run.run_id,
        event,
        capacity: this.availableCapacity(),
      });
      await this.commitAndApply(transition);
    });
  }

  private async commitAndApply(transition: TurnTransition): Promise<void> {
    if (!transition.delta.is_empty) {
      await this.store.commitTurnTransition({
        session_id: this.session_id,
        turn_id: this.id,
        active_executor_id: this.activeExecutorId,
        ...transition.delta,
      });

      // Store first, memory second.
      this.orchestrator.applySnapshot(transition.next_snapshot);
      await this.publishCommitted(transition.delta.output_events);
    }

    for (const run of transition.runs_to_start) {
      this.startRun(run); // Registers the run; does not await LLM/tool work.
    }

    this.registry.updatePausedKeepalive(this);
  }

  private async pumpThreadRun(run: ThreadRun, signal: AbortSignal): Promise<ThreadRunResult> {
    const execution = this.orchestrator.executeThread(run, signal);

    while (true) {
      const next = await execution.next();
      if (next.done) return next.value;

      const event = next.value;
      if (event.type === EventType.MODEL_MESSAGE_DELTA) {
        this.publishDelta(event);
      } else {
        await this.onThreadEvent(run, event);
      }
    }
  }
}
```

`submitInbound()`, thread-event callbacks, run-completion callbacks, cancellation, and offload all use the same transition lock. LLM/tool execution remains outside the lock. A caller awaiting `submitInbound()` returns only after its transition commits; a thread generator awaiting `onThreadEvent()` advances only after its durable event commits.

One transition contains accepted inbox writes, queued-event changes, yielded thread/context events, selected run starts, and the derived turn state. It is persisted atomically, so no partial orchestration decision is visible. The lock is an implementation primitive inside `TurnHandle`, not another runtime/domain object.

## 7. Important flows

### 7.1 One child waits while another continues

```text
child A produces tool.approval_required
  -> commit A waiting
  -> B remains ready/running
  -> turn remains running

child B completes
  -> result delivered to parent
  -> only A remains unfinished and waiting
  -> turn becomes paused
```

### 7.2 Event arrives while sibling LLM is running

```text
POST event
  -> HTTP validates authentication and payload shape
  -> request layer resolves the owner; the local registry obtains its TurnHandle
  -> request layer calls or remotely forwards submitInbound(event)
  -> HTTP waits for submitInbound() to commit

TurnHandle
  -> sibling LLM remains in flight
  -> acquires the same transition lock used by thread callbacks
  -> passes the event and current snapshot to computeInboundTransition()

AgentThreadOrchestrator
  -> locates event.thread_id in the committed thread snapshot
  -> routes the event to that thread's local validator

target AgentThread
  -> requires status = waiting
  -> matches event type and tool_call_id against required_actions
  -> verifies the tool call is still open and actually requires this input

valid
  -> transition inserts the inbox row as pending
  -> adds the durable event to the orchestrator queue with the target thread ID
  -> waiting -> ready
  -> TurnHandle commits the queue transition
  -> HTTP returns success
  -> TurnHandle starts target AgentThread.execute(inbound_events) if capacity exists

target AgentThread.execute()
  -> applies the supplied input first
  -> yields context append + public user approval/response event
  -> TurnHandle commits context + output event + inbox applied
  -> committed event is published to SSE/subscribers
  -> execute() continues into tools/LLM

invalid or already resolved
  -> orchestrator returns InvalidInboundEventError
  -> no inbox or thread write
  -> HTTP returns 4xx
```

`TurnHandle` coordinates serialization, persistence, and generator pumping; it does not understand approval semantics. Child B's LLM generator continues in flight throughout this sequence. The target thread's approval event is streamed by its own `execute()` generator, not privately consumed by `send()`.

### 7.3 Pause, offload, and continue

```text
all leaves waiting
  -> commit paused
  -> keep hot for grace TTL

event during grace
  -> existing handle validates and durably queues it
  -> target execute() streams/applies it and continues

TTL expires
  -> registry offloads handle and closes resources

later event
  -> owner rebuilds paused handle
     OR another replica wins paused ownership CAS and rebuilds
  -> rebuilt handle validates the submitted event
  -> one commit inserts the inbox row and makes the thread ready
  -> turn changes to running
  -> target execute() streams/applies the event
  -> same turn continues
```

### 7.4 Cancellation race

```text
cancel wins first
  -> turn becomes cancelled
  -> late thread event/result fails the non-terminal/active-executor fence

thread event/result wins first
  -> its atomic transition commits
  -> cancel then transitions the latest non-terminal state
```

No partial transition is visible.

### 7.5 Creating a new turn while one is non-terminal

`createTurn(previous_turn_id: 'auto')` must not silently inherit from a `running` or `paused` predecessor.

- Normal continuation waits for terminal state.
- Explicit barge-in/steer cancels the old turn with a recorded reason, then creates the successor.
- Forking from an older terminal turn remains allowed.

## 8. Migration plan

### Phase 1 — Establish the pause lifecycle

- Separate the execution task owned by `TurnHandle` from the create/SSE response iterator that observes it.
- Keep the active `TurnHandle`, resolver, and execution resources registered when execution reaches HITL.
- Using the existing `AgentThreadExecutionResult.required_actions`, persist `paused` instead of `done + required_actions`.
- Emit `turn.update(paused)` and do not emit `turn.done` at HITL.
- Let create/SSE disconnect without cancelling or finalizing the turn.
- Continue closing resources on cancellation, error, true completion, or process shutdown.
- Keep paused handles in memory indefinitely for this phase; keepalive expiry and rebuild come later.
- Do not resume from `POST events` yet. The paused handle is intentionally inert until inbound application is added.

Done when a turn can become paused, remain addressable under the same `turn_id`, and outlive its original SSE response without being finalized.

### Phase 2 — Keep `AgentThread` run-until-blocked and move inbound processing into `execute()`

- Keep the existing initialize → LLM → tools → HITL/done loop inside `AgentThread.execute()`.
- Keep approval/response validation pure; prepare accepted durable event objects without mutating context.
- Remove approval/client-response context application from `send()`.
- At the start of `execute()`, apply the supplied input by yielding one append-context event containing both the context representation and public user event.
- Add/widen the internal durable-change event's `public_events` field so inbound user events use the same persistence/SSE path as agent output events.
- Advance past each yield only after the runtime commits it.
- Return a coarse `ThreadRunResult` such as blocked/done/error; do not expose internal LLM/tool steps.
- Preserve model delta streaming and current within-thread HITL semantics.

### Phase 3 — Add the in-memory turn runtime

- Keep the thread map, parent/child routing, turn-state derivation, and leaf scheduling in `AgentThreadOrchestrator`.
- Add one orchestrator-owned `pending_inbound` queue; route applicable entries into `ThreadRun.inbound_events` when scheduling.
- Make the orchestrator's `compute*Transition()` methods produce candidate snapshots/deltas without mutating current state.
- Add one per-turn transition lock and independent thread-generator pumps to `TurnHandle`.
- Apply computed transitions directly in memory for this phase.
- Add coarse `ThreadStatus` with `ready`, `running(run_id)`, `waiting`, and terminal states.
- Add an activation/offload lock to `ActiveTurnRegistry`.
- Replace the global `shouldStopExecution` with per-thread waiting state.
- Remove generator merging after parity tests pass.

Done when one waiting child does not stop runnable siblings.

For the first version, preserve current within-thread behavior: if one assistant message has several tool calls and any require user input, that thread waits as a unit. Cross-thread independence is the required change.

### Phase 4 — Inbound events while running, in memory

- Deliver the existing events endpoint through the live `TurnHandle.submitInbound()` method.
- Have `computeInboundTransition()` reject invalid events or append accepted events to the orchestrator queue with their target thread IDs.
- Apply only to targeted waiting threads.
- Let unrelated thread executions continue running.
- Start the target thread's `execute()` run so the accepted approval/response is emitted through the normal event stream before tools/LLM continue.
- Return `4xx` for semantic validation errors and success after the in-memory queue transition is accepted.
- Scope this phase to hot handles. Restart recovery, remote-owner delivery, and offload are intentionally deferred.

### Phase 5 — Complete same-turn resume

- Allow the events endpoint to call `submitInbound()` on the paused handles retained by Phase 1.
- When accepted input makes work runnable, derive `running`, emit `turn.update(running)`, and schedule the target thread automatically.
- Resume the same handle and `turn_id`; do not create a successor turn for approval/response input.
- Ensure the accepted user event is streamed/applied before subsequent tool or LLM work.
- Deprecate approval-only `createTurn`.

At this point the complete behavior works within one live process, but it is not yet restart-safe.

### Phase 6 — Durable transitions and ownership fencing

- Use a generated `<executor_id>.<4-char-generation>` value in the existing `active_executor_id` column.
- Fence progress writes by exact `active_executor_id`.
- Add atomic `commitTurnTransition()`.
- Persist thread status, required actions, run identity, and `paused|running` state.
- Apply the orchestrator's next snapshot only after the transaction succeeds.

Keep the Phase 5 behavior unchanged while moving its state transitions behind the store transaction.

### Phase 7 — Durable inbox and owner dispatch

- Add accepted inbox insert/update operations to `TurnTransition.delta`.
- Extend inbox rows from `consumed: boolean` to pending/applied/rejected/discarded, or equivalent timestamps.
- Resolve the owner, forward the full submission, and await its validated store commit.
- Return unavailable when a running owner cannot be reached; never start a second running handle.
- Commit accepted events as pending, then atomically mark them applied with the context append and public streamed event yielded by `execute()`.
- Invalid submissions produce no inbox write.
- Backfill Redis from Postgres before guaranteeing all subscribe/send orders.

Paused handles remain hot through this phase; rebuilding an offloaded handle comes next.

### Phase 8 — Offload and ownership transfer

- Rebuild paused handles from `TurnRecord`.
- Start/rebuild a paused handle when an event arrives and none is hot.
- Load pending inbox rows before scheduling.
- Add paused keepalive expiry.
- Add paused-only owner claim CAS.
- Never steal a running turn in v1.
- Add dispatch-failure and ownership-race chaos tests.

## 9. Tests

### `AgentThread`

- every local state transition;
- approval and client-tool targeting;
- accepted approval/response does not mutate context before it is supplied to `execute()`;
- `execute()` yields the public inbound event and matching context append before continuing;
- `send()` does not privately apply approval/response context;
- all currently pending actions for one thread remain a unit in v1;
- async processor and resource-init steps;
- abort during LLM/tool execution;
- complete message/context persisted while deltas remain ephemeral.

### `AgentThreadOrchestrator`

- one waiting thread plus one runnable sibling derives running;
- all unfinished leaves waiting derives paused;
- inbound events route only to their targeted thread;
- invalid events return typed validation errors without a transition;
- accepted events enter the orchestrator queue and make only their target thread runnable;
- child results reach the parent exactly once;
- duplicate child completion does not create another tool response;
- computing transitions does not mutate current state;
- scheduling obeys capacity without changing HITL semantics.

### `TurnHandle`

- an event without a matching committed required action rejects `submitInbound()` before persistence;
- queued input is streamed/applied while an unrelated thread run continues;
- inbound success resolves only after the transition commits;
- a durable yielded event commits before its generator advances;
- store commit happens before orchestrator snapshot application;
- stale run ID or `active_executor_id` generation fails closed;
- cancellation races with run output/completion;
- no subscriber is required for progress.

### Store contracts

- exact `active_executor_id` fencing;
- atomic thread + inbox + event + turn-state commit;
- accepted inbox insertion versus cancel serialization;
- terminal immutability;
- exactly one paused ownership claimant;
- Postgres/SQLite/in-memory parity.

### End to end

- subscribe then send;
- send then subscribe;
- concurrent subscribe/send;
- invalid POST returns `4xx` and creates no inbox row;
- POST success only after the local/remote owner validates and commits;
- approval/response appears in SSE and event listing before resulting tool/LLM output;
- disconnected create SSE can replay the committed inbound event through `subscribe`;
- retry after a lost success response cannot resolve the same required action twice;
- unreachable running owner returns unavailable and creates no inbox row;
- immediate event during paused keepalive;
- event after same-owner offload;
- event after paused-owner death and steal;
- multiple children with independent required actions;
- Redis behind Postgres.

## 10. Prior art used

- [Temporal event history](https://docs.temporal.io/workflow-execution/event): explicit durable progress, signals, children, and sticky in-memory execution.
- [Restate external events](https://docs.restate.dev/develop/ts/external-events): durable messages and suspension without retaining a process.
- [XState actors](https://stately.ai/docs/actors): one-message-at-a-time processing and persisted snapshots.

TrueForge should use checkpoint restoration, not deterministic workflow replay. The current LLM/tool/capability stack is nondeterministic, and v1 does not need running-effect recovery.
