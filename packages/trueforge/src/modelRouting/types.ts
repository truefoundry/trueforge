export const MODEL_ROUTING_MODES = ['off', 'on'] as const;

export type ModelRoutingMode = (typeof MODEL_ROUTING_MODES)[number];

/** One of the caller's models. */
export interface RoutingCandidate {
  /** `provider/model`, as the harness resolves it. */
  model: string;
  /** Provider-neutral model id (e.g. `anthropic/claude-haiku-5-5`); the routing key. */
  canonicalModel?: string | undefined;
  /** Blended USD per million tokens: 0.75 × input + 0.25 × output. Logged only. */
  price?: number | undefined;
}
