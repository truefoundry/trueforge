import { AgentSpecSchema, DEFAULT_AGENT_CONFIG_ITERATION_LIMIT } from '../../src/agent-session/schemas/agentSpec';

describe('AgentSpec RuntimeConfig defaults', () => {
  it('materializes config when omitted', () => {
    const spec = AgentSpecSchema.parse({ model: { name: 'provider/model' } });
    expect(spec.config.iteration_limit).toBe(DEFAULT_AGENT_CONFIG_ITERATION_LIMIT);
    expect(spec.config.sandbox).toEqual({ enabled: false, file_downloads: true });
    expect(spec.config.generative_ui).toEqual({ enabled: true });
    expect(spec.config.ask_user_questions).toEqual({ enabled: true });
    expect(spec.config.dynamic_sub_agents).toEqual({ enabled: true });
    expect(spec.config.context_management.compaction).toEqual({ enabled: true });
    expect(spec.config.context_management.large_tool_response.enabled).toBe(true);
  });

  it('accepts an explicit input-token compaction trigger', () => {
    const spec = AgentSpecSchema.parse({
      model: { name: 'provider/model' },
      config: {
        context_management: {
          compaction: {
            enabled: true,
            trigger: { type: 'input_tokens', value: 80_000 },
          },
        },
      },
    });

    expect(spec.config.context_management.compaction).toEqual({
      enabled: true,
      trigger: { type: 'input_tokens', value: 80_000 },
    });
  });

  it.each([
    {
      name: 'by itself',
      compaction: { enabled: false, compaction_threshold_tokens: 80_000 },
    },
    {
      name: 'alongside the new trigger',
      compaction: {
        enabled: true,
        compaction_threshold_tokens: 80_000,
        trigger: { type: 'input_tokens', value: 90_000 },
      },
    },
  ])('rejects the legacy compaction threshold $name', ({ compaction }) => {
    expect(
      AgentSpecSchema.safeParse({
        model: { name: 'provider/model' },
        config: {
          context_management: {
            compaction,
          },
        },
      }),
    ).toMatchObject({ success: false });
  });

  it('fills generative_ui when other config fields are present', () => {
    const spec = AgentSpecSchema.parse({
      model: { name: 'provider/model' },
      config: { sandbox: { enabled: true } },
    });
    expect(spec.config.sandbox.enabled).toBe(true);
    expect(spec.config.sandbox.file_downloads).toBe(true);
    expect(spec.config.generative_ui.enabled).toBe(true);
  });

  it('allows opting out of generative_ui', () => {
    const spec = AgentSpecSchema.parse({
      model: { name: 'provider/model' },
      config: { generative_ui: { enabled: false } },
    });
    expect(spec.config.generative_ui.enabled).toBe(false);
  });
});
