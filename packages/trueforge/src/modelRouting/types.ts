export const MODEL_ROUTING_MODES = ['off', 'shadow', 'on'] as const;

export type ModelRoutingMode = (typeof MODEL_ROUTING_MODES)[number];

/** One of the caller's models. Only models whose slug has a score become routing candidates. */
export interface RoutingCandidate {
  /** `provider/model`, as the harness resolves it. */
  model: string;
  /** Artificial Analysis slug; the score lookup key. */
  slug?: string | undefined;
  /** Reasoning effort the model runs at when none is set. */
  defaultEffort?: string | undefined;
  /** Blended USD per million tokens: 0.8 × input + 0.2 × output. */
  price?: number | undefined;
  imageInput?: boolean | undefined;
}

export type ListRoutingCandidates = () => Promise<RoutingCandidate[]>;

export interface DecisionQuestion {
  instructions: string;
  criteria: { true: string; false: string };
}

export interface DecisionClient {
  /**
   * Yes-probability per question key. `fallbackModel` is the model whose provider config the call
   * may borrow; keys the decision model didn't answer are omitted.
   */
  ask(input: {
    fallbackModel: string;
    threadId: string;
    state: Record<string, unknown>;
    questions: Record<string, DecisionQuestion>;
    signal: AbortSignal;
  }): Promise<Record<string, number>>;
}
