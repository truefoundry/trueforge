import { Registry } from 'prom-client';
import { createOperationMetrics } from '../../../src/observability/agentMetrics';

describe('createOperationMetrics', () => {
  it('exposes outbound request, duration, and retry series with bounded labels', async () => {
    const registry = new Registry();
    const metrics = createOperationMetrics(registry);
    metrics.recordOutboundHttpRequest({
      module: 'model',
      outcome: 'success',
      statusClass: '2xx',
      durationSeconds: 0.01,
    });
    metrics.recordOutboundHttpRetry({ module: 'mcp', reason: 'connect_timeout' });

    const text = await registry.metrics();
    expect(text).toContain('tfg_outbound_http_requests_total');
    expect(text).toContain('module="model"');
    expect(text).toContain('outcome="success"');
    expect(text).toContain('status_class="2xx"');
    expect(text).toContain('tfg_outbound_http_request_duration_seconds_bucket');
    expect(text).toContain('tfg_outbound_http_retries_total');
    expect(text).toContain('reason="connect_timeout"');
    expect(text).not.toContain('tfg_outbound_http_blocked_total');
  });
});
