import { metrics } from '@opentelemetry/api';
import { PrometheusExporter, PrometheusSerializer } from '@opentelemetry/exporter-prometheus';
import { MeterProvider } from '@opentelemetry/sdk-metrics';

let scrapeSdkMetrics: (() => Promise<string>) | undefined;

/**
 * One global meter for SDK instrumentation that already calls `metrics.getMeter`.
 * Daytona `WithInstrumentation` records on each call. `DaytonaConfig.otelEnabled`
 * starts a separate OTLP trace SDK and does not turn those meters on.
 * Redis `OpenTelemetry.init` records here too.
 * The exporter does not open a port; `GET /metrics` appends its text.
 */
export function startSdkMetrics(): () => Promise<string> {
  if (scrapeSdkMetrics !== undefined) {
    return scrapeSdkMetrics;
  }
  const exporter = new PrometheusExporter({
    preventServerStart: true,
    withoutTargetInfo: true,
    withoutScopeInfo: true,
  });
  const provider = new MeterProvider({ readers: [exporter] });
  metrics.setGlobalMeterProvider(provider);
  const serializer = new PrometheusSerializer(undefined, false, undefined, true, true);
  scrapeSdkMetrics = async () => {
    const { resourceMetrics, errors } = await exporter.collect();
    if (errors.length > 0) {
      const message = errors.map(error => (error instanceof Error ? error.message : String(error))).join('; ');
      const [first] = errors;
      throw new Error(`SDK metrics collection failed: ${message}`, first === undefined ? undefined : { cause: first });
    }
    return serializer.serialize(resourceMetrics);
  };
  return scrapeSdkMetrics;
}
