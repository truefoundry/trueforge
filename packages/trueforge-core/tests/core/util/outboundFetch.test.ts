import {
  DEFAULT_MODEL_HTTP_HEADERS_TIMEOUT_MS,
  defaultMcpOutboundFetchOptions,
  defaultModelOutboundFetchOptions,
  defaultOutboundFetchOptions,
} from '../../../src/core/util/outboundFetch';

describe('defaultModelOutboundFetchOptions', () => {
  it('uses a 20-second header timeout without changing other model defaults', () => {
    expect(DEFAULT_MODEL_HTTP_HEADERS_TIMEOUT_MS).toBe(20_000);
    expect(defaultModelOutboundFetchOptions()).toEqual({
      connectTimeoutMs: 5_000,
      headersTimeoutMs: 20_000,
      bodyTimeoutMs: 120_000,
      maxRetries: 2,
      idempotent: true,
    });
  });

  it('keeps generic outbound and MCP header timeouts unchanged', () => {
    expect(defaultOutboundFetchOptions().headersTimeoutMs).toBe(5_000);
    expect(defaultMcpOutboundFetchOptions().headersTimeoutMs).toBe(120_000);
  });
});
