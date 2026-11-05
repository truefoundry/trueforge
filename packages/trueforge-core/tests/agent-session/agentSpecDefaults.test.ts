import { AgentSpecSchema, DEFAULT_AGENT_CONFIG_ITERATION_LIMIT } from '../../src/agent-session/schemas/agentSpec';

describe('AgentSpec RuntimeConfig defaults', () => {
  it.each([undefined, {}])('defaults the iteration limit to 1024 with config %p', config => {
    const spec = AgentSpecSchema.parse({ model: { name: 'provider/model' }, config });
    expect(spec.config.iteration_limit).toBe(1024);
  });

  it.each([1, 512, 1024])('preserves an explicit iteration limit of %i', iteration_limit => {
    const spec = AgentSpecSchema.parse({
      model: { name: 'provider/model' },
      config: { iteration_limit },
    });
    expect(spec.config.iteration_limit).toBe(iteration_limit);
  });

  it('rejects iteration limits above 1024', () => {
    expect(
      AgentSpecSchema.safeParse({ model: { name: 'provider/model' }, config: { iteration_limit: 1025 } }).success,
    ).toBe(false);
  });

  it('materializes config when omitted', () => {
    const spec = AgentSpecSchema.parse({ model: { name: 'provider/model' } });
    expect(spec.config.iteration_limit).toBe(DEFAULT_AGENT_CONFIG_ITERATION_LIMIT);
    expect(spec.config.sandbox).toEqual({ enabled: false, file_downloads: true });
    expect(spec.config.generative_ui).toEqual({ enabled: true });
    expect(spec.config.ask_user_questions).toEqual({ enabled: true });
    expect(spec.config.dynamic_sub_agents).toEqual({ enabled: true });
    expect(spec.config.context_management.compaction).toEqual({ enabled: true });
    expect(spec.config.context_management.large_tool_response.enabled).toBe(true);
    expect(spec.config.web_search).toEqual({ enabled: false });
    expect(spec.config.memory).toEqual({ enabled: false });
  });

  it('accepts an explicit memory toggle', () => {
    const spec = AgentSpecSchema.parse({
      model: { name: 'provider/model' },
      config: { memory: { enabled: true } },
    });
    expect(spec.config.memory).toEqual({ enabled: true });
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
