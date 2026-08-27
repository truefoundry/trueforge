import { DEFAULT_HOOK_TIMEOUT_MS, HooksFileSchema } from '../../../src/schemas/hooks';

describe('HooksFileSchema', () => {
  it('applies entry defaults and empty arrays for absent events', () => {
    const parsed = HooksFileSchema.parse({
      version: 1,
      hooks: {
        pre_tool_use: [{ type: 'command', command: 'echo hi' }],
      },
    });
    expect(parsed.hooks.pre_tool_use).toEqual([
      { type: 'command', command: 'echo hi', timeout_ms: DEFAULT_HOOK_TIMEOUT_MS, fail_mode: 'open' },
    ]);
    expect(parsed.hooks.user_prompt_submit).toEqual([]);
    expect(parsed.hooks.post_tool_use).toEqual([]);
    expect(parsed.hooks.turn_done).toEqual([]);
  });

  it('keeps explicit timeout_ms and fail_mode', () => {
    const parsed = HooksFileSchema.parse({
      version: 1,
      hooks: {
        turn_done: [{ type: 'command', command: 'notify', timeout_ms: 5000, fail_mode: 'closed' }],
      },
    });
    expect(parsed.hooks.turn_done[0]).toEqual({
      type: 'command',
      command: 'notify',
      timeout_ms: 5000,
      fail_mode: 'closed',
    });
  });

  it('tolerates unknown event keys so newer writers do not fail older servers', () => {
    const parsed = HooksFileSchema.parse({
      version: 1,
      hooks: {
        pre_tool_use: [{ type: 'command', command: 'echo hi' }],
        some_future_event: [{ type: 'command', command: 'echo future', unknown_option: true }],
      },
    });
    expect(parsed.hooks.pre_tool_use).toHaveLength(1);
  });

  const invalidCases = [
    { name: 'unknown version', file: { version: 2, hooks: {} } },
    { name: 'missing hooks', file: { version: 1 } },
    { name: 'empty command', file: { version: 1, hooks: { pre_tool_use: [{ type: 'command', command: '' }] } } },
    {
      name: 'unknown entry key',
      file: { version: 1, hooks: { pre_tool_use: [{ type: 'command', command: 'x', matcher: '*' }] } },
    },
    {
      name: 'unknown entry type',
      file: { version: 1, hooks: { pre_tool_use: [{ type: 'webhook', command: 'x' }] } },
    },
    {
      name: 'non-integer timeout',
      file: { version: 1, hooks: { pre_tool_use: [{ type: 'command', command: 'x', timeout_ms: 1.5 }] } },
    },
    { name: 'top-level unknown key', file: { version: 1, hooks: {}, extra: true } },
  ];

  test.each(invalidCases)('rejects $name', ({ file }) => {
    expect(HooksFileSchema.safeParse(file).success).toBe(false);
  });
});
