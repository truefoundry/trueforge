# Turn steal, cancel, races, and tests

Companion to durable pause / ownership. This doc locks **v1 steal policy**, **cancel vs steal**, **races + fixes**, and **test cases**.

Client contract (unchanged): no `resumeTurn`. Client **sends events** and/or **subscribes**. When HITL is fully resolved, the server emits `running` and continues the **same** turn.

---

## 1. Steal policy (v1)

**Steal only when the tip is** `paused`**.** Never steal a `running` turn.

Steal = CAS-claim `active_executor_id` (+ generation) on the TurnRecord, then rebuild ActiveTurn from snapshot + unconsumed inbox. Loser of the CAS does not run the machine.

### When B may steal

All of the following:

1. Tip status is `paused`.
2. `active_executor_id` is **someone else**.
3. Peer result is `NoResponderError` (heartbeat missing, or publish with 0 subscribers).
4. This replica is **not** blind (Redis/transport is up).

Then:

```text
UPDATE turn
SET active_executor_id = $me_with_generation
WHERE turn_id = $t
  AND active_executor_id = $expected
  AND state->>'status' = 'paused'
```

Winner rebuilds.

### When B must not steal

| Situation                                                         | Do this instead                                                     |
| ----------------------------------------------------------------- | ------------------------------------------------------------------- |
| Tip `running`                                                     | Do not claim.                                                       |
| Tip `cancelled` / `done` / `error`                                | Do not claim.                                                       |
| `RequestTimeoutError` (heartbeat still present, no reply in time) | Do not steal. 503 / retry. Owner may still be applying.             |
| Redis/network error on **this** replica                           | Do not steal. We cannot see heartbeats. 503.                        |
| Peer returns **412** (alive, no ActiveTurn)                       | Do not steal. Owner should rebuild. Empty registry ≠ dead executor. |
| We are already DB owner, no ActiveTurn                            | **Rebuild** (same owner). Not a steal.                              |

### Why paused-only

- `paused` **(after keepalive offload):** no live generator, no in-flight MCP/LLM on the owner. Claiming the row and rebuilding is taking a sleeping tip, not interrupting execute.
- `running`**:** owner may still be calling tools. Stealing then → **double tool calls**. OWNER only blocks **later DB writes**; it does not un-fire tools A already started.
- **Timeout ≠ dead.** Treat as “can’t connect / slow,” not “no executor.”
- **v1:** humans wait on **paused** approvals across pod death/deploy. A crashed **running** turn is ended (freeze/cancel) or replaced (`createTurn`), not resumed on another replica.

Signals already in request-reply:

| Signal                           | Error                 | Steal paused? |
| -------------------------------- | --------------------- | ------------- |
| Heartbeat key missing            | `NoResponderError`    | Yes           |
| Publish subscriber count 0       | `NoResponderError`    | Yes           |
| Heartbeat up, no reply in budget | `RequestTimeoutError` | No            |
| Local Redis/transport failure    | other                 | No            |

If turn is `running` and we cannot peer:

| Client intent             | Behavior                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Cancel**                | Same as today: freeze → `cancelled`. Old owner’s persist loses the `running` fence.                                            |
| **createTurn / barge-in** | Freeze predecessor (`cancelled-for-next-turn`) → new tip on this replica. Not steal.                                           |
| **send-event**            | Reject (503 / 424 owner unavailable) or freeze then 409 (tip no longer writable). **Do not** apply approvals on a new machine. |
| **subscribe**             | Tail existing PG/Redis events, or 503. **Do not** start execute.                                                               |

---

## 2. Wake resolution (send or subscribe)

Same function, local or via peer:

```text
Load TurnRecord
if terminal → send reject / subscribe read-only; stop
if owner == me && ActiveTurn → handle under per-turn lock
if owner == me && no ActiveTurn && paused → rebuild, then handle
if owner == me && no ActiveTurn && running → reject (execute gone)
if owner != me → callPeer (locate)
  ok (200) → forward
  no_responder && paused → steal (CAS; winner rebuilds)
  no_responder && running → retry (no steal)
  failed (timeout / 412 / Redis down) → retry; no steal
```

Keepalive: after pause, ActiveTurn stays for a short TTL. Send during grace uses the live machine (no rebuild). After TTL, offload; next send hits “owner + no ActiveTurn → rebuild.”

---

## 3. Races and how to close them

`resolveOwnershipAction` only picks an action (`run` / `rebuild` / `forward` / `steal` / `reject` / `retry`). It does **not** serialize two HTTP handlers or claim the row. Acting on `steal` / `rebuild` / `run` still races unless the fixes below are in place.

**Already decided in the table (policy only):** steal iff `paused` + `no_responder`. Timeout / 412 / Redis-down → `failed` → `retry`. That is R4’s _when_, not the CAS.

**Still to implement around the action:**

| After the table says | Race if we just do it                                                |
| -------------------- | -------------------------------------------------------------------- |
| `run`                | Two POSTs mutate one ActiveTurn (R7)                                 |
| `rebuild`            | Two rebuilds on this replica (R2); `has` then `await` then gone (R1) |
| `steal`              | Two replicas both rebuild (R5); old owner still writing (R6)         |
| `forward`            | Peer applies; we must not also run                                   |
| cancel / freeze      | Interleaves with send apply (R8)                                     |

Per-turn lock + owner CAS on persist + steal CAS are the three closers. Do not trust `hasActiveTurn` or `getTurn` across an unlocked `await`.

### R1 — Offload vs “still have ActiveTurn?”

**Race:** `if (registry.has(id))` then `await …` then use handle; timer deletes in between. Or both sides decide “empty → rebuild.”

**Fix:** Per-turn lock covers lookup, offload, handle, and rebuild. Offload timer takes the **same** lock. After acquiring, re-read registry + DB owner. Never trust `hasActiveTurn` across an unlocked `await`.

### R2 — Two rebuilds on the same replica

**Race:** Two requests see owner=us, no ActiveTurn → two ActiveTurns, both persist as `R`.

**Fix:** Rebuild only under the per-turn lock. Bump generation on rebuild (or claim). Stale in-memory epoch fails persist CAS.

### R3 — Offload vs inbound apply (same process)

**Race:** TTL delete interleaves with POST enqueue/apply.

**Fix:** Offload and apply share the per-turn lock.

### R4 — False “no executor” (steal vs hot owner)

**Race:** Heartbeat expired; A still has keepalive ActiveTurn or finishing a handler.

**Fix:** Steal only `paused` + `NoResponderError`. A’s next persist fails owner CAS → abort local machine. Do not steal on timeout.

### R5 — Two stealers

**Race:** A dead; B and C both claim.

**Fix:** Single conditional `UPDATE`. Exactly one winner. Loser does not rebuild.

### R6 — Steal vs late persist from old owner

**Race:** B owns; A still appending events.

**Fix:** All progress writes (`updateTurnState`, `appendToEvents`, `appendToThreadContext`, inbox insert) require `active_executor_id` match in the **same** statement. CAS fail → lost ownership, stop stream.

### R7 — Two HTTP handlers, one ActiveTurn?

**Race:** Two approval POSTs interleave `pending` / consume across `await`.

**Fix:** Per-turn mutex / promise chain. Wait (queue), don’t 409 by default. Different turn ids run in parallel.

### R8 — Cancel / barge-in vs send-event

**Race:** One request freezes tip; other inserts inbox / applies.

**Fix:** Cancel uses **status** CAS (`running|paused` → `cancelled`). Send owner-write fails if tip not writable. Same per-turn lock so freeze and apply don’t interleave.

### R9 — Shutdown vs steal

**Race:** A `stopHeartbeat` + drain; B steals; A finishes an in-flight handler.

**Fix:** In-flight persist fails if claim already won. Do not steal because drain returned 412 while heartbeat still exists.

### R10 — Heartbeat dies mid-peer wait

**Race:** Peer published; A dies while B polls.

**Fix:** Client already rechecks heartbeat and throws `NoResponderError` (then steal if `paused`). If a reply later appears, ignore — GETDEL or treat as stale; winner is DB owner after CAS.

---

## 4. Test scenarios

| Setup                                             | Action             | Expect                                                          |
| ------------------------------------------------- | ------------------ | --------------------------------------------------------------- |
| `paused`, owner A, heartbeat gone                 | B send-event       | B wins CAS, rebuilds, applies; A persist fails                  |
| `paused`, owner A, heartbeat **up**, peer timeout | B send-event       | No steal; 503/retry; owner unchanged                            |
| `paused`, owner A, B Redis down                   | B send-event       | No steal; 503                                                   |
| `running`, owner A, `NoResponderError`            | B send-event       | No steal; 503 or freeze+409 — tip not continued on B            |
| `running`, owner A, `NoResponderError`            | B cancel           | Tip `cancelled` (freeze); no rebuild execute                    |
| `paused`, no responder, B and C both eligible     | Concurrent claim   | Exactly one winner; loser no ActiveTurn / no execute            |
| A owns, ActiveTurn offloaded, heartbeat up        | B peers send       | A rebuilds (412 must not cause B steal)                         |
| A owns + local ActiveTurn                         | B send             | Peer to A; A handles; no CAS owner change                       |
| A owns, no ActiveTurn                             | A send             | Rebuild, no steal                                               |
| Tip `cancelled`                                   | send-event         | Reject; no steal, no inbox apply                                |
| Tip `cancelled`                                   | subscribe          | History only; no wake                                           |
| Tip `done`                                        | send-event         | Reject                                                          |
| `paused`, no ActiveTurn                           | cancel             | `cancelled`; createTurn can continue session                    |
| `paused`, keepalive ActiveTurn                    | cancel             | Abort + registry empty + `cancelled`                            |
| `running`, local                                  | cancel             | Abort; tip cancelled (existing path)                            |
| `running`, other owner, peer 200                  | cancel             | Owner aborted; tip terminal                                     |
| `running`, other owner, no responder              | cancel             | Freeze `cancelled`                                              |
| Already `cancelled`                               | cancel             | No-op                                                           |
| Cancel vs send on `paused`                        | concurrent         | One winner: cancelled **or** events applied, not both executing |
| Just paused (inside TTL)                          | send on owner      | Live ActiveTurn; no rebuild                                     |
| After TTL                                         | send on owner      | Registry empty then rebuild; apply works                        |
| TTL fires during send                             | concurrent         | Lock: apply finishes or offload waits; no crashed pending       |
| Two POSTs same turn                               | concurrent         | Serialized apply; both durable in inbox                         |
| Two POSTs different turns                         | concurrent         | Parallel                                                        |
| Check-has then offload then use                   | forced interleave  | Must not use deleted handle (lock/re-read)                      |
| B stole `paused`; A still has leftover ActiveTurn | A persist          | CAS fail; A aborts; only B’s events land                        |
| A heartbeat flapped; A still owner                | B sees timeout     | No steal                                                        |
| Same replica two rebuilds                         | concurrent wake    | One ActiveTurn / one generation wins                            |
| send then crash before apply                      | rebuild            | Unconsumed rows replay; no lost approval                        |
| apply then crash before consume                   | rebuild            | Idempotent; no double tool if already persisted                 |
| Partial approvals                                 | send one of N      | Stay `paused`; no execute                                       |
| Last approval                                     | send               | `running` + continue same `turn_id`                             |
| subscribe then send                               | order              | Subscriber sees `running` + later events (backfill if needed)   |
| send then subscribe                               | order              | Same, no missed tail                                            |
| concurrent send + subscribe                       | both               | No double execute; one owner                                    |
| `running`, no responder                           | createTurn message | Old tip cancelled; new tip runs on caller                       |
| `running`, no responder                           | subscribe          | No new execute on subscriber’s replica                          |
