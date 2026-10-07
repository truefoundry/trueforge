# In-memory event-driven turn executor

Status: proposed implementation plan. Companion to `turn-runtime-redesign.md`. Scope-narrowed for the current iteration.

## 1. Goal & scope

Make the turn executor a long-lived in-memory loop that keeps processing user events (approvals, tool responses, approval policies, mcp-auth continues) as they arrive, instead of ending the run at the first HITL.

Explicitly in scope:

- One waiting thread must not stop runnable siblings (remove the turn-wide `shouldStopExecution`).
- User events resume the _same_ paused turn in place — no new successor turn for approval/response input.
- `send()` is the single user-event entry point; `execute()` consumes.

Explicitly deferred (do **not** build now):

- Offload / rebuild of a paused turn, keepalive TTL, ownership CAS.
- Durable inbox rows / `active_executor_id` fencing / `commitTurnTransition`.
- Restart recovery.
- Cosmetic scaffolding types (`ThreadStatus`, `ThreadRun`, `ThreadRunResult`, a standalone queue/registry object). Use the data we already have.

## 2. Design principles (from review)

1. No new status/run/result value types. Runnability is derived from the live thread map + `isAwaitingUserInput()` + "has queued user events", exactly like `getActiveAgentThreads()` derives leaves today.
2. `send()` is a **store-free generator**: it validates, `yield`s the accepted events for the caller to persist durably, then commits them to the in-memory queue only after the caller resumes it (persist-before-mutate; the orchestrator never touches the store). It does not mutate context. The orchestrator drains and applies queued events before deciding whether the thread can run the normal `initialize → LLM → tools → HITL/done` loop.
3. **No separate submit method.** `AgentThreadOrchestrator.send()` is the submit method; the `POST /events` handler drains it on the live handle.
4. Durability is deferred: the `yield` in `send()` is the seam where the caller's durable pending-insert will land; for now the caller drains without a durable write. The queue is a plain in-memory list; `execute()` only marks consumed.

## 3. `AgentThread` changes

### 3.1 `send()` stays a store-free generator (validate → yield-for-persist → enqueue)

Today `send()` is an `async *` generator that validates and then _itself_ appends approval/response/user context (yielding `AGENT_CONTEXT_APPEND`, mutating context). Change _what_ it yields, not that it yields: it validates, yields the accepted events for the caller to persist durably, then — only after the caller resumes it — pushes them onto a per-thread queue. It no longer mutates context and no longer runs `preSend`/`contextBusy`; context application moves to `execute()` (§3.2).

```ts
// AgentThread
private pendingUserEvents: AgentThreadRuntimeSendInput[] = [];

// Store-free generator. Validate, hand the caller the accepted events to
// persist durably, then commit to the in-memory queue only on resume
// (persist-before-mutate). No context mutation, no preSend, no contextBusy.
*send(messages: AgentThreadRuntimeSendBatch): Generator<AgentThreadRuntimeSendBatch> {
  this.validateSendInput(messages); // pure; + queued-dedupe (§7)
  yield messages;                    // caller persists here (deferred for now)
  this.pendingUserEvents.push(...messages);
}

hasPendingUserEvents(): boolean {
  return this.pendingUserEvents.length > 0;
}
```

Validation runs against committed context _before_ the `yield`, so an invalid batch throws before any persist or enqueue (fail-closed preserved). If the caller's durable write (at the `yield`) throws, the generator is never resumed, so the in-memory queue is untouched. `validateSendInput()` stays for the HTTP-layer pre-check.

### 3.2 The orchestrator drains + applies user events before execution

Before computing runnable leaves, the orchestrator applies queued user events. This lets a partial approval be persisted while the thread remains paused. This is the only place approval/response context is written (removed from `send()`), so those user events go through the normal persisted event stream.

```ts
// AgentThread
async *applyPendingEvents(): AsyncGenerator<ApplyUserEventsOutput, void> {
  yield* this.apply(this.pendingUserEvents.splice(0));
}

async *apply(events: AgentThreadRuntimeSendInput[]): AsyncGenerator<ApplyUserEventsOutput, void> {
  for (const e of events) {
    // approval -> AgentApprovalDecisionMessage + user.tool_approval public event
    // client tool response / child LLMToolMessage -> tool message + tool.response public event
    // user message -> processAgentUserInput() (sandbox), no public event
    const { context, publicEvent } = /* reuse the mapping currently inside send() */;
    yield* this.appendToContext({
      context,
      output: publicEvent ? [publicEvent] : [], // widen: user events ARE outputs for persistence/SSE
      currentContextUsage: undefined,
      usage: undefined,
    });
  }
}
```

Note: the mapping (approval → `AgentApprovalDecisionMessage`, client response → `LLMToolMessage`, user message → `processAgentUserInput`) is exactly what `send()` does today; it moves verbatim into `apply`. `appendToContext` already yields-before-mutating, preserving store-before-next ordering. `output` is reused to carry the public user event so it hits the same `TurnHandle.persistExecutionEvent` → events path; no new field needed now.

## 4. `AgentThreadOrchestrator` changes

### 4.1 `send()` routes + yields (stays a generator, store-free)

```ts
*send(messages: AgentThreadSendBatch): Generator<AgentThreadRuntimeSendBatch> {
  // Same routing/validation as today (per thread_id for approval/response
  // batches; main thread for user messages; reject user messages while
  // sub-agents run), then delegate to the target thread's generator:
  yield* thread.send(batch); // validate -> yield-for-persist -> enqueue on resume
}
```

This is the method `POST /events` drains on the live handle to resume a turn. The handler persists each yielded batch (§6); the orchestrator itself never calls the store.

### 4.2 Infinite executor loop (the core change)

Replace the single-pass `while (size>0) { merge; if stop break }` + "return paused" with a loop that parks on a wake signal and resumes:

```ts
private wake = signalable();       // resolved by send() (below)
notifyWake(): void { this.wake.notify(); }

async *execute({ signal }): AsyncGenerator<AgentThreadExecutionEvent, AgentThreadExecutionResult> {
  onSignalAbort(signal, () => this.wake.notify());
  for (;;) {
    if (signal.aborted) return { status: 'done', output, root_agent_error };

    // Runnable leaves: leaf threads that will make progress now — either not
    // awaiting user input, or awaiting input but with queued user events to apply.
    const runnable = getActiveAgentThreads(agentThreads).filter(
      t => !t.isAwaitingUserInput() || t.hasPendingUserEvents(),
    );

    if (runnable.length > 0) {
      // Same batched merge as today, but scoped to runnable leaves. A thread's
      // execute() returns when it blocks (HITL) or finishes — NO turn-wide stop.
      for (const batch of chunk(runnable, MAX_PARALLEL_SUB_AGENTS)) {
        for await (const chunk of mergeAsyncGenerators(wrap(batch), logger)) {
          yield* this.processAgentStreamChunk(chunk, signal); // unchanged routing
        }
      }
      continue; // re-derive after progress
    }

    // Nothing runnable:
    const state = deriveTurnState(agentThreads); // done | error | paused
    if (state.status !== 'paused') return toExecutionResult(state);

    yield turnStateEvent(state);   // -> TurnHandle persists turn.update(paused)
    await this.wake.wait();        // park until send() enqueues or signal aborts
    if (signal.aborted) return { status: 'done', output, root_agent_error };
    yield turnStateEvent({ status: 'running' }); // -> turn.update(running)
  }
}
```

Key points:

- **Remove** `shouldStopExecution`**.** A thread that yields `tool.approval_required` / `tool.response_required` / `mcp.auth_required` simply blocks itself (its `execute()` returns via the existing `stepUserInputRequired`/auth exit). It is not re-scheduled until it has queued user events. Runnable siblings keep going. This is the "one child waits while another continues" fix.
- **No duplicate required-action events.** A blocked thread with no queued user events is filtered out of `runnable`, so `execute()` is not re-entered to re-emit the same approval-required event. When user events arrive, `apply` clears the awaiting state and the thread proceeds past HITL.
- `deriveTurnState` (small pure helper, no new types): `error` if root errored; `done` if root finished and required children finished; else `paused` with `required_actions` gathered from every leaf currently awaiting input (reuse `agentThreadEventToTerminalFields` / the events the threads yielded). This subsumes the current `mergeAuthEvents` tail — mcp-auth is just another per-thread wait.
- `execute()` **returns only on terminal** (root done/error) or abort. Paused is an in-loop park, never a return.

### 4.3 Child-result routing uses the same enqueue path

`processAgentStreamChunk`'s child-completion branch already calls `applyToThread(parent, [send_to_parent])`. It drains that thread's `send()` generator in-process — no durable write for this internal `LLMToolMessage` (it is reconstructable from execution) — pushing the child's tool response onto the parent's `pendingUserEvents`; the parent becomes a runnable leaf (child removed from the map) and applies the tool response on its next `execute()` run. No special case — `AgentThreadRuntimeSendInput` already unions `LLMToolMessage`.

## 5. `TurnHandle` changes (minimal)

1. **Wake instead of park-until-abort.** `TurnHandle.send(messages)` drains `orchestrator.send(messages)` under the per-turn lock (§7), persisting each yielded batch (deferred for now), then calls `orchestrator.notifyWake()`. The running `stream()` generator keeps consuming `execute()`, so a resumed run just yields more events. The current `waitUntilAborted` park in `stream()` is removed — parking now lives inside `orchestrator.execute()`.
2. **Persist non-terminal flips.** When `execute()` yields the turn-state event (§4.2), map it to `store.updateTurnNonTerminalState` + `turn.update` (paused _and_ running) — generalize the existing `persistTurnPaused` helper (#924, formerly #898) to both directions using #896's method. Terminal handling (`persistTurnTerminal`) is unchanged.

Resources still close only on terminal/abort/shutdown (unchanged from #924); create-SSE disconnect does not finalize.

## 6. Wiring `POST /events`

Replace the stub in `turns.ts` (`createTurnEventHandler`, currently mints ids and returns 201 without applying):

- Look up the live handle for `${sessionId}:${turnId}` in `ActiveTurnRegistry` (add a handle/`send` sink to `track()`, as anticipated by the approval-policy doc's submit-sink note).
- No live handle → 409 (no offload/rebuild this iteration).
- Live handle → drain `handle.send(events)` under the per-turn lock (§7): for each yielded batch do the durable persist (deferred for now — no-op), let the generator resume to enqueue, then `notifyWake()`.
  - invalid batch → typed validation error → 4xx, nothing persisted or enqueued;
  - valid → persisted (deferred) + enqueued + woken → 201.
- Approval-policy items keep flowing through `applyApprovalPolicies`; mcp-auth-continue routes like a response (marks its thread runnable).

## 7. Concurrency

`send()` is drained by an async HTTP handler that — once durability lands — will `await` a durable write between validate and enqueue. That `await` makes concurrent `POST /events` interleavable, so ordering must be enforced explicitly rather than relying on the event loop.

**Requirement: a per-turn async mutex (transition lock).** Implement one lock per live turn/handle. Every `send()` drain (validate → persist → enqueue) and every executor state-transition/commit point acquires it, so each is atomic per turn. This is the `turn-runtime-redesign.md` "per-turn transition lock". Single lock, single process — cross-replica ownership (`active_executor_id` fencing, owner forwarding) stays deferred.

Details:

- **The event loop is not enough.** Purely synchronous sections are already atomic on Node's single thread, but the generator is consumed by an awaiting caller, so two concurrent drains can interleave at the `await`. Wire the lock now so the pattern is correct by construction the moment the durable persist is added.
- **Reject events for a non-waiting thread.** `send()` validates against `this.context`. Only accept user events for a thread currently _awaiting user input_; a running thread has no pending action, so validation 4xxs it. This is what keeps `send()` from reading context the executor is concurrently mutating — the target thread is always quiescent.
- **Validate against already-queued events (dedupe).** Because `send()` does not mutate context, two concurrent full batches would both validate against the same committed context and both enqueue → double-apply. Validation must also consider `pendingUserEvents` already queued, so a second batch resolving the same pending action is rejected. Preserves "each pending action resolved exactly once" without the durable inbox.
- **Latching wake.** `signalable()` must latch: a `notify()` with no waiter parked makes the next `wait()` return immediately. Otherwise a `send()` landing in the window between the loop's "nothing runnable" check and its `await wake.wait()` is lost and the turn parks forever (lost-wakeup).

## 8. `createTurn` initial input — keep the atomic pre-send

`SessionHandle.createTurn()` today runs a **"SEND BEFORE COMMIT"** pre-send: it validates the initial input, applies it to the thread(s), and persists the resulting `new_context_appends` **atomically in the same** `store.createTurn` **transaction** as the turn row, thread inits, and capability states (`applyContextAppends` is part of that single write). If validation throws, nothing is persisted.

**Decision: keep this behavior.** `createTurn` continues to apply + persist the initial user message up front; only **mid-turn** events (approvals/resume via `POST /events`) go through the enqueue-and-wake generator path. Deferring the initial message to `execute()` is rejected because it would:

- break atomicity (a window where the turn row exists without its initial message in the persisted context/snapshot),
- lose durability if the executor never starts (crash before start, offload disabled, replica death) — the message would live only in `turn.input`, never applied to context, a regression vs. "SEND BEFORE COMMIT",
- change the persisted user-message contract for the most common path (every turn creation), for no benefit since the initial message is already validated + persisted correctly today.

This is **not** two divergent code paths: the shared primitive is `apply` (§3.2), called synchronously (atomic with commit) by `createTurn` and inside `execute()`'s drain loop for mid-turn events. Since generator `send()` no longer yields `AGENT_CONTEXT_APPEND`s, the current `collectContextAppends(orchestrator.send(sendBatch))` line becomes: validate the batch first (the same synchronous `validateSendInput` check `send()` runs — mid-turn events are validated inside `send()`, but `createTurn` has no `send()`), then `collectContextAppends(orchestrator.apply(sendBatch))`. Throw ⇒ nothing persisted; success ⇒ `new_context_appends` for the atomic `store.createTurn`.

## 9. Tests to add/adjust

- One child `tool.approval_required` does not stop a runnable sibling; sibling runs to done; turn then derives paused.
- Approval via `send()` while paused resumes the same turn/`turn_id`; the `user.tool_approval` event appears before the resulting tool/LLM output.
- Invalid `POST /events` batch → 4xx, nothing enqueued, turn stays paused.
- `send()` does not mutate context; `execute()` applies queued user events before the first derived LLM/tool step.
- No duplicate `tool.approval_required` across park/resume cycles.
- Child result delivered to parent exactly once through the enqueue path.
- Existing #924 pause-persistence tests updated for wake/resume (running↔paused `turn.update` round-trip).
- Concurrency (§7): two concurrent `POST /events` for the same turn are serialized by the per-turn lock; a duplicate/overlapping batch is rejected (validated against already-queued events); no double-apply.
- Latching wake: a `send()` racing the loop's park does not deadlock (wake is not lost).
- `send()` targeting a running (non-waiting) thread returns 4xx.
- If the caller's durable persist throws at the `yield`, the generator does not resume and `pendingUserEvents` is unchanged.

## 10. Partial approvals

Status: **implemented.** A `POST /events` batch may resolve a subset of a thread's pending approvals. Accepted decisions are applied and persisted immediately, while tool execution remains gated until every approval on the issuing assistant message is decided.

### 10.1 Incremental validation

`validateSendInput` validates each approval or client-side response against the pending calls in committed context and subtracts inputs already accepted into `pendingUserEvents`, preventing a second request from resolving an already-queued call. Both input types may arrive incrementally.

### 10.2 Target behavior

A batch may carry a _subset_ of decisions. Each decision is applied to context (and persisted) incrementally; the thread stays `user-input-required` until **all** of its pending approvals / client-side calls are resolved, then proceeds to execute tools. Approved tools do **not** run until every approval on the issuing assistant message is decided — we keep `deriveAgentThreadState`'s all-or-nothing gate for tool _execution_; only the _input_ becomes incremental.

### 10.3 Implementation

1. **Send-batch validation.** There is no completeness check for approvals. Per-message validity remains, including dedupe within the batch and against already-queued decisions.
2. **State machine.** `deriveAgentThreadState` continues to return `user-input-required` while any approval is undecided.
3. **Apply before runnable selection.** The orchestrator calls `applyPendingEvents()` before `isRunnable()`. A partial decision is persisted without re-entering `execute()`, so required-action events are not duplicated.
4. **Turn state.** An apply-only wake re-emits `paused` without first emitting `running`. `running` is emitted only after the final decision makes at least one thread model-runnable.

### 10.4 Tests

- Resolve 1 of N approvals on a thread → decision applied to context, turn stays `paused`, `tool.approval_required` re-emitted for the remaining; a second batch resolves the rest → thread proceeds; the approved tool executes only after the final decision.
- An apply-only (partial) wake does not flip turn-state to `running`.
- Dedupe: a second batch re-deciding an already-queued id is rejected (§7).
