# Redis request-reply peering + cross-replica cancellation

Bring the gateway's executor-peering mechanism into the harness so `POST /{sessionId}/cancel`
works when the HTTP request lands on a different replica than the one running the turn.

Reference implementation (gateway): `tfy-llm-gateway/src/redis/request-reply/*`,
`src/agent/responseHandler/{ResponsePeering,peeringIds}.ts`, `cancelSessionTurn` in
`src/agent/sessionTurnHandler/sessionTurnHandler.ts`.

**Non-goals:** zone peering (multi-region HTTP proxying) stays gateway-only.
Redis-backed `ISessionStore` is a separate track (see Prerequisites).

## Mechanism recap

- Every replica has a unique `executorId`, embedded into turn ids at mint time:
  `01hxyz....g.srv-ab12cd` (`<ulid>.<zone>.<executor>`, zone fixed to `g` — keeps the
  gateway's `parsePeeringId` grammar so both systems stay interoperable).
- Each replica subscribes to redis pub/sub channel `rr:req:<executorId>` and refreshes a
  heartbeat key `rr:hb:<executorId>` (TTL ≈ 1.5× interval).
- Caller: check heartbeat → `PUBLISH {replyKey, path, body, headers}` → poll `rr:reply:<uuid>`
  with `GETDEL` until reply or timeout. `NoResponderError` → HTTP 412, `RequestTimeoutError` → 424.
- Callee: in-process router keyed by logical path (`sessions/cancel`) → handler returns
  `{status, headers, body}` → `SET replyKey <json> PX <ttl>`.

## Folder structure after

```
packages/harness/src/
├── request-reply/                    # NEW — published as @truefoundry/utils/request-reply
│   ├── index.ts                      # barrel: client, executor, router, errors, types, peeringIds
│   ├── types.ts                      # RequestEnvelope, PublishedRequest, JSONReply (zod)
│   ├── errors.ts                     # NoResponderError, RequestTimeoutError, ReplyError(status)
│   ├── keys.ts                       # heartbeatKey / requestChannel / replyKey (rr: prefix)
│   ├── redisConnection.ts            # RedisConnection interface (DI seam, no client dep)
│   ├── client.ts                     # redisRequest(...) — ported, all deps injected
│   ├── executor.ts                   # RequestReplyExecutor — ported, no Sentry/hono/config
│   ├── router.ts                     # RequestReplyRouter — throws ReplyError, not HTTPException
│   └── peeringIds.ts                 # parsePeeringId / executorFromTurnId / mintPeeredTurnId
├── agent-session/
│   └── Sessions.ts / SessionHandle.ts  # CHANGED — injectable mintTurnId
└── core/ ...                         # untouched

packages/server/src/
├── config.ts                         # CHANGED — REDIS_URL, EXECUTOR_ID, rr timeouts
├── main.ts                           # CHANGED — boot executor, drain on shutdown
├── runtime/
│   ├── activeTurns.ts                # unchanged (the local abort seam)
│   ├── redis.ts                      # NEW — node-redis client from REDIS_URL (optional)
│   └── peering.ts                    # NEW — router + executor composition, cancel route handler
└── apis/
    └── sessions.ts                   # CHANGED — cancel: local vs remote via turn id

docker-compose.yml                    # CHANGED — redis service, REDIS_URL/EXECUTOR_ID env
```

## 1. `packages/harness/src/request-reply/` (new module)

Port of the gateway files with dependencies inverted. What changes vs the gateway copy:

| Gateway (today)                            | Harness package                                  |
| ------------------------------------------ | ------------------------------------------------ |
| `import config from '../../config'`        | plain option parameters with defaults            |
| `import redis from '../index'` (singleton) | `RedisConnection` interface injected             |
| `import { logger }` (winston global)       | `logger: Logger` parameter (existing convention) |
| `Sentry.captureException(...)`             | optional `onError?: (err: Error) => void` hook   |
| `HTTPException` (hono)                     | package-owned `ReplyError` carrying `status`     |

```ts
// redisConnection.ts — the only thing hosts must implement
export interface RedisConnection {
  isReady(): boolean;
  onReady(fn: () => void): void;
  /** node-redis style commands used by the module */
  get client(): {
    exists(key: string): Promise<number>;
    set(key: string, value: string, opts: { PX: number }): Promise<unknown>;
    getDel(key: string): Promise<string | null>;
    publish(channel: string, message: string): Promise<number>;
    subscribe(channel: string, listener: (message: string) => void): Promise<void>;
    unsubscribe(channel: string): Promise<void>;
    duplicate(): ...;
  };
  isSentinelMode(): boolean; // sentinel subscribes on the shared client (gateway behavior)
}
```

```ts
// client.ts — signature after the port
export async function redisRequest<T extends JSONValue>(input: {
  redis: RedisConnection;
  executorId: string;
  path: string;
  request: RequestEnvelope<T>;
  options?: { replyTimeoutMs?: number; pollIntervalMs?: number }; // defaults: 10_000 / 150
}): Promise<JSONReply>;
```

```ts
// executor.ts — signature after the port
export class RequestReplyExecutor {
  constructor(input: {
    executorId: string;
    redis: RedisConnection;
    router: RequestReplyRouter;
    logger: Logger;
    options?: { heartbeatIntervalMs?: number; replyTtlMs?: number };
    onError?: (error: Error) => void; // gateway wires Sentry here
  });
  async init(): Promise<void>;
  async drain(): Promise<void>; // close + await in-flight handlers
}
```

```ts
// router.ts — no hono
export class RequestReplyRouter {
  addRoute<T extends JSONValue>(path: string, fn: (req: RequestEnvelope<T>) => Promise<JSONReply>): void;
  async route(path: string, req: RequestEnvelope<any>): Promise<JSONReply>; // unknown path → ReplyError(500)
}
```

```ts
// peeringIds.ts — same grammar as gateway peeringIds.ts, minus response_id kinds
export const SINGLE_ZONE_ID = 'g';
export function mintPeeredTurnId(executorId: string, zone = SINGLE_ZONE_ID): string {
  return `${ulid().toLowerCase()}.${zone}.${executorId}`;
}
/** `<ulid>.<zone>.<executor>` → executor; bare ulid → undefined */
export function executorFromTurnId(turnId: string): string | undefined;
```

Packaging: add `./request-reply` to `package.json#exports` + tsup entry (same pattern as
`./agent-session`). No new runtime deps (zod + ulid already present; redis stays out via the
interface).

## 2. `agent-session`: injectable turn-id minting

`SessionHandle.ts:183` today: `const turnId = ulid().toLowerCase();`

```ts
// Sessions options (threaded through to SessionHandle)
export interface SessionsOptions<...> {
  ...
  /** Mint turn ids. Default: bare lowercase ulid. Peered servers pass mintPeeredTurnId. */
  mintTurnId?: () => string;
}

// SessionHandle.createTurn
const turnId = this.deps.mintTurnId?.() ?? ulid().toLowerCase();
```

No format validation elsewhere — turn ids are opaque to the store; wire schemas already
accept dotted ids (gateway proves this).

## 3. `packages/server`: composition

```ts
// config.ts — additions
REDIS_URL: string | undefined; // unset ⇒ peering disabled, local-only cancel
EXECUTOR_ID: string; // default: `srv-${randomUUID().slice(0, 8)}`
REDIS_REQUEST_REPLY_TIMEOUT_MS: number; // default 10_000
REDIS_REQUEST_REPLY_HEARTBEAT_INTERVAL_MS: number; // default 5_000
```

```ts
// runtime/redis.ts — thin node-redis wrapper implementing RedisConnection; undefined when no REDIS_URL

// runtime/peering.ts
export const PEERING_PATHS = { SESSIONS_CANCEL: 'sessions/cancel' } as const;

export function initPeering(deps: {
  redis: RedisConnection | undefined;
  activeTurns: ActiveTurnRegistry;
  logger: Logger;
}) {
  if (!deps.redis) return undefined; // single-process mode: everything stays local
  const router = new RequestReplyRouter();
  router.addRoute(PEERING_PATHS.SESSIONS_CANCEL, async ({ body }) => {
    const found = deps.activeTurns.cancelIfRunning({
      sessionId: body.session_id,
      turnId: body.turn_id,
      abortReason: body.reason,
    });
    return found ? { status: 200, body: {} } : { status: 412, body: { message: 'not running here' } };
  });
  const executor = new RequestReplyExecutor({ executorId: config.EXECUTOR_ID, redis: deps.redis, router, logger });
  return { executor, redis: deps.redis };
}
// main.ts: await peering?.executor.init() at boot; peering?.executor.drain() in graceful shutdown
```

```ts
// apis/sessions.ts — cancelSessionHandler becomes owner-aware
if (record.last_turn_id) {
  const owner = executorFromTurnId(record.last_turn_id);
  if (peering && owner && owner !== config.EXECUTOR_ID) {
    try {
      const reply = await redisRequest({
        redis: peering.redis,
        executorId: owner,
        path: PEERING_PATHS.SESSIONS_CANCEL,
        request: {
          body: { session_id: sessionId, turn_id: record.last_turn_id, reason: CancellationReason.ClientCancelled },
        },
      });
      if (reply.status !== 200 && reply.status !== 412) return c.json({ error: { message: 'cancel failed' } }, 500);
    } catch (e) {
      if (e instanceof NoResponderError) return c.json({ error: { message: 'executor unreachable' } }, 412);
      if (e instanceof RequestTimeoutError) return c.json({ error: { message: 'cancel timed out' } }, 424);
      throw e;
    }
  } else {
    deps.activeTurns.cancelIfRunning({
      sessionId,
      turnId: record.last_turn_id,
      abortReason: CancellationReason.ClientCancelled,
    });
  }
}
```

Sessions construction (wherever `deps.sessions` is built): pass
`mintTurnId: () => mintPeeredTurnId(config.EXECUTOR_ID)` only when `REDIS_URL` is set,
so single-process ids stay bare ulids.

## 4. docker-compose

```yaml
services:
  redis:
    image: redis:7-alpine
    ports: ['6379:6379']
    healthcheck: { test: ['CMD', 'redis-cli', 'ping'], interval: 5s, timeout: 3s, retries: 5 }

  server:
    environment:
      REDIS_URL: redis://redis:6379
      EXECUTOR_ID: server-1
    depends_on:
      redis: { condition: service_healthy }

  # optional second replica to exercise peering locally
  server-2:
    extends: { service: server }
    environment: { EXECUTOR_ID: server-2, PORT: 8791 }
    ports: ['8791:8791']
```

## 5. Tests

- `packages/harness/tests/request-reply/*.test.ts` (gated on `REDIS_URL`, or `redis-memory-server` dev dep):
  - round-trip: two executors on one redis, request routed to the right one
  - heartbeat missing → `NoResponderError`; zero subscribers → `NoResponderError`
  - no reply within budget → `RequestTimeoutError`; reply key TTL honored
  - router: duplicate `addRoute` throws; unknown path → 500 reply
- `peeringIds`: bare ulid, `<ulid>.g.<exec>` round-trips; gateway-format ids parse identically
- server: cancel handler unit tests — local path (owner == self), remote path (mock redisRequest),
  412/424 mapping; `mintTurnId` only active when peering enabled
- e2e (compose, 2 replicas): start turn on server-1, cancel via server-2, assert `turn.done` cancelled

## Divergences from the gateway (explicit)

Wire-compatible by design: `rr:*` keys, request/reply envelopes, heartbeat/GETDEL mechanics,
412/424 error mapping, and the `<ulid>.<zone>.<executor>` grammar are identical.

Deliberate (OSS-friendly) divergences:

- Peering is **opt-in** (`REDIS_URL`); gateway always mints peered ids. Consequence: enabling
  peering changes the turn-id format mid-history — pre-peering turns are not routable
  (tolerated by the parser, same as gateway legacy ids).
- No zone tier, no legacy `agent/responses` paths, no sentinel support in the OSS
  `RedisConnection` impl, empty forward-headers (single-tenant). All strict subsets; the
  envelope/interface keep the slots for gateway adoption.

Behavioral gaps to resolve during implementation (decisions, not accidents):

1. **Teardown wait on cancel.** Gateway cancel blocks until the run is torn down (timeout → 424).
   `ActiveTurnRegistry.cancelIfRunning` returns immediately after abort. Fix: peering cancel
   handler awaits `run.waitUntilCompleted` (already tracked) with a timeout; 424 on expiry.
   Apply the same wait to the local path in `cancelSessionHandler` for parity.
2. **Cancel-the-tail on create-turn.** Gateway create-turn cancels a running previous turn
   (`CancelledForNextTurn`, best-effort). Harness removed process-local single-active-turn
   enforcement (ebac8b5); multi-replica needs the owner-aware cancel hop on the create-turn
   path too — or an explicit decision to allow concurrent turns per session.
3. **Streaming is out of scope for request-reply.** Cross-replica subscribe/listEvents needs
   shared event storage (redis streams), owned by the shared-store track. This plan delivers
   cross-replica _commands_ only.

## Prerequisites / sequencing

1. **Shared session store caveat:** with `InMemorySessionStore`, the replica receiving the cancel
   can't even load the session — cross-replica cancel is only meaningful once a shared
   `ISessionStore` (redis-backed) lands. The mechanism here is still built and testable now
   (peering module has no store dependency; e2e test needs the shared store first).
2. Land package module + id minting (steps 1–2), publish.
3. Land server wiring + compose (steps 3–4).
4. **Gateway follow-up (separate PR, that repo):** delete `src/redis/request-reply/`, import from
   `@truefoundry/utils/request-reply` behind a small composition file (injects gateway redis
   singleton, config values, winston logger, Sentry hook); keep zone peering + response-id
   grammar in `ResponsePeering.ts`/`peeringIds.ts` gateway-side; `executorPeeringErrorToResponse`
   switches its `instanceof` checks to the package error types.
