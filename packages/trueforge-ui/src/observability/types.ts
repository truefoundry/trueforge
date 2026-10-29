/** Flat context attached to a captured error or breadcrumb. Hosts forward it to their vendor. */
export type ObservabilityContext = Record<string, string | number | boolean | undefined>;

/** Host-supplied error/trace sinks (Sentry, Datadog RUM, …). The SDK never ships a vendor client. */
export type ObservabilityConfig = {
  /** Something an engineer should look at, e.g. a stream that failed or stalled. */
  captureError?: (error: unknown, context: ObservabilityContext) => void;
  /** Step log the vendor attaches to the next captured error. */
  addBreadcrumb?: (breadcrumb: { category: string; message: string; data?: ObservabilityContext }) => void;
};
