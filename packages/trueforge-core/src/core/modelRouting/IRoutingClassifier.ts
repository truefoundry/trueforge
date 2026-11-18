/** What the classifier is asked about: a thread that's about to start, and the task it was given. */
export interface RoutingState {
  threadId: string;
  /** Optional short label for the task. */
  name?: string | undefined;
  instructions: string;
}

export interface RoutingClassification {
  /** Expected to be one of the router's cluster names; anything else keeps the fallback model. */
  category: string;
  /** Logged with the routing decision. */
  details: Record<string, unknown>;
}

/** Decides which cluster of models a task needs. */
export interface IRoutingClassifier {
  classify(state: RoutingState, signal: AbortSignal): Promise<RoutingClassification>;
}
