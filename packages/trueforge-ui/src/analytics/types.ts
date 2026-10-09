/** Props attached to a product-analytics event. Hosts forward these to their vendor. */
export type AnalyticsEventProps = Record<string, string | number | boolean | undefined>;

/** Host-supplied sink. The SDK never ships a vendor client. */
export type TrackAnalytics = (eventName: string, data?: AnalyticsEventProps) => void;

/** Optional host analytics config passed to `<TrueForgeUI />`. */
export type AnalyticsConfig = {
  track: TrackAnalytics;
};
