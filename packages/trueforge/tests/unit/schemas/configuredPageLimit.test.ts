import configuration from '../../../src/config';
import { ListSessionEventsRequestQuerySchema } from '../../../src/schemas/events';
import { ListTurnEventsRequestQuerySchema, ListTurnsRequestQuerySchema } from '../../../src/schemas/turn';

describe.each([
  ['ListSessionEventsRequestQuerySchema', ListSessionEventsRequestQuerySchema, 'LIST_EVENTS_PAGE_LIMIT_MAX'],
  ['ListTurnEventsRequestQuerySchema', ListTurnEventsRequestQuerySchema, 'LIST_EVENTS_PAGE_LIMIT_MAX'],
  ['ListTurnsRequestQuerySchema', ListTurnsRequestQuerySchema, 'LIST_TURNS_PAGE_LIMIT_MAX'],
] as const)('%s limit', (_name, schema, configKey) => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it(`defaults to ${configKey} when omitted`, () => {
    expect(schema.parse({}).limit).toBe(configuration[configKey]);
  });

  it('accepts query-string values up to the configured max', () => {
    const max = configuration[configKey];
    expect(schema.parse({ limit: '1' }).limit).toBe(1);
    expect(schema.parse({ limit: String(max) }).limit).toBe(max);
  });

  it('rejects values above the configured max, zero, and non-integers', () => {
    const max = configuration[configKey];
    expect(schema.safeParse({ limit: String(max + 1) }).success).toBe(false);
    expect(schema.safeParse({ limit: '0' }).success).toBe(false);
    expect(schema.safeParse({ limit: '1.5' }).success).toBe(false);
  });

  it('reads the configured max at parse time', () => {
    jest.replaceProperty(configuration, configKey, 500);
    expect(schema.parse({}).limit).toBe(500);
    expect(schema.parse({ limit: '500' }).limit).toBe(500);
    expect(schema.safeParse({ limit: '501' }).success).toBe(false);
  });
});
