/**
 * The seam between the executor (wire semantics, package-owned) and
 * connection management (host-owned). The package never creates, connects or
 * closes Redis connections: the host expresses its topology — standalone
 * duplicate, Sentinel shared client, ... — as a `Subscription` and the
 * executor only ever calls `subscribe()` / `close()` on it.
 */

/** Everything the executor hands to a `Subscription` when attaching. */
export interface SubscriptionHooks {
  /** `rr:req:<executorId>` — the channel to subscribe to (never recompute key grammar). */
  channel: string;
  /**
   * Feed every raw pub/sub payload here. Hosts may wrap it (e.g. report
   * malformed messages to their error tracker) before forwarding.
   */
  onMessage: (message: string) => void;
  /**
   * Signal that the subscription is live: call once subscribe succeeds and
   * again after a re-subscribe. Starts the executor heartbeat — calling it
   * before the subscription is live advertises a responder that is not
   * listening, so callers time out instead of failing fast.
   */
  onLive: () => void;
  /**
   * Signal that the subscription broke (subscriber error/end). Stops the
   * heartbeat so callers fail fast with NoResponderError instead of
   * publishing into the void.
   */
  onLost: () => void;
}

/** Host-owned attach/detach strategy for the executor's request channel. */
export interface Subscription {
  /**
   * Establish the subscription and resolve once attached; reject on failure
   * (the executor logs and leaves the heartbeat off). Must invoke the hooks
   * per their contracts above.
   */
  subscribe(hooks: SubscriptionHooks): Promise<void>;
  /**
   * Release only what `subscribe` created (unsubscribe; close a duplicated
   * client if one was made — never the host's primary client). Must not throw.
   */
  close(): Promise<void>;
}
