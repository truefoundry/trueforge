/**
 * Seam between the package-owned executor (wire semantics) and host-owned
 * connection management: the host expresses its topology as a `Subscription`.
 */

/** Everything the executor hands to a `Subscription` when attaching. */
export interface SubscriptionHooks {
  /** Channel to subscribe to. */
  channel: string;
  /** Feed every raw pub/sub payload here (hosts may wrap it first). */
  onMessage: (message: string) => void;
  /** Subscription is live (initial subscribe and each re-subscribe); starts the heartbeat. */
  onLive: () => void;
  /** Subscription broke; stops the heartbeat so callers fail fast. */
  onLost: () => void;
}

/** Host-owned attach/detach strategy for the executor's request channel. */
export interface Subscription {
  /**
   * Engage the subscription; `onLive` (not this promise) signals serving.
   * Implementations may self-heal from their own connection events and
   * resolve despite a failed first attach; reject only when the host should
   * own the retry — `init()` propagates the rejection and stays retryable.
   */
  subscribe(hooks: SubscriptionHooks): Promise<void>;
  /** Release only what `subscribe` created — never the host's primary client. Must not throw. */
  close(): Promise<void>;
}
