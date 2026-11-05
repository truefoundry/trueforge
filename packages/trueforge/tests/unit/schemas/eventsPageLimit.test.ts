import configuration from '../../../src/config';
import { ListSessionEventsRequestQuerySchema } from '../../../src/schemas/events';
import { ListTurnEventsRequestQuerySchema } from '../../../src/schemas/turn';

describe.each([
  ['ListSessionEventsRequestQuerySchema', ListSessionEventsRequestQuerySchema],
  ['ListTurnEventsRequestQuerySchema', ListTurnEventsRequestQuerySchema],
])('%s limit', (_name, schema) => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('defaults to LIST_EVENTS_PAGE_LIMIT_MAX when omitted', () => {
    expect(schema.parse({}).limit).toBe(configuration.LIST_EVENTS_PAGE_LIMIT_MAX);
  });

  it('accepts query-string values up to the configured max', () => {
    const max = configuration.LIST_EVENTS_PAGE_LIMIT_MAX;
    expect(schema.parse({ limit: '1' }).limit).toBe(1);
    expect(schema.parse({ limit: String(max) }).limit).toBe(max);
  });

  it('rejects values above the configured max, zero, and non-integers', () => {
    const max = configuration.LIST_EVENTS_PAGE_LIMIT_MAX;
    expect(schema.safeParse({ limit: String(max + 1) }).success).toBe(false);
    expect(schema.safeParse({ limit: '0' }).success).toBe(false);
    expect(schema.safeParse({ limit: '1.5' }).success).toBe(false);
  });

  it('reads the configured max at parse time', () => {
    jest.replaceProperty(configuration, 'LIST_EVENTS_PAGE_LIMIT_MAX', 500);
    expect(schema.parse({}).limit).toBe(500);
    expect(schema.parse({ limit: '500' }).limit).toBe(500);
    expect(schema.safeParse({ limit: '501' }).success).toBe(false);
  });
});
