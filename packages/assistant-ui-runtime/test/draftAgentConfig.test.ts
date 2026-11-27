import { describe, expect, it } from 'vitest';

import { fixedModelName, mergeAgentSpec, modelParams } from '../src/draft/agentSpec.js';
import type { AgentChatServer } from '../src/server/index.js';
import type { AgentSpec } from '../src/server/types.js';
import { resolveTrueForgeAgentConfig, resolveTrueForgeAgentRuntimeOptions } from '../src/types.js';

describe('resolveTrueForgeAgentConfig', () => {
  it('supports legacy agentName', () => {
    expect(resolveTrueForgeAgentConfig({ agentName: 'my-agent' })).toEqual({
      mode: 'named',
      agentName: 'my-agent',
    });
  });

  it('prefers explicit agentName over named config', () => {
    expect(
      resolveTrueForgeAgentConfig({
        agent: { mode: 'named', agentName: 'ignored' },
        agentName: 'preferred',
      }),
    ).toEqual({
      mode: 'named',
      agentName: 'preferred',
    });
  });

  it('returns draft config unchanged', () => {
    const spec: AgentSpec = { model: { type: 'fixed', name: 'openai/gpt-4o' } };
    expect(
      resolveTrueForgeAgentConfig({
        agent: { mode: 'draft', defaultAgentSpec: spec },
      }),
    ).toEqual({
      mode: 'draft',
      defaultAgentSpec: spec,
    });
  });
});

describe('resolveTrueForgeAgentRuntimeOptions', () => {
  const server = {} as AgentChatServer;

  it('accepts draft mode without a private client', () => {
    const resolved = resolveTrueForgeAgentRuntimeOptions({
      server,
      agent: { mode: 'draft', defaultAgentSpec: { model: { type: 'fixed', name: 'x' } } },
    });
    expect(resolved.server).toBe(server);
    expect(resolved.agent.mode).toBe('draft');
  });

  it('resolves named mode with server', () => {
    const resolved = resolveTrueForgeAgentRuntimeOptions({
      server,
      agent: { mode: 'named', agentName: 'my-agent' },
    });
    expect(resolved.server).toBe(server);
    expect(resolved.agent).toEqual({ mode: 'named', agentName: 'my-agent' });
  });
});

describe('mergeAgentSpec', () => {
  it('deep-merges model params', () => {
    const base: AgentSpec = {
      model: {
        type: 'fixed',
        name: 'anthropic/claude-sonnet-4-6',
        params: { maxTokens: 1024, reasoningEffort: 'medium' },
      },
    };
    const next = mergeAgentSpec(base, {
      model: { params: { reasoningEffort: 'high' } },
    });
    expect(modelParams(next.model)).toEqual({ maxTokens: 1024, reasoningEffort: 'high' });
  });

  it('replaces mcpServers array wholesale', () => {
    const base: AgentSpec = {
      model: { type: 'fixed', name: 'openai/gpt-4o' },
      mcpServers: [{ id: 'github', name: 'github' }],
    };
    const next = mergeAgentSpec(base, {
      mcpServers: [{ id: 'slack', name: 'slack' }],
    });
    expect(next.mcpServers).toEqual([{ id: 'slack', name: 'slack' }]);
  });

  it('replaces skills array wholesale', () => {
    const base: AgentSpec = {
      model: { type: 'fixed', name: 'openai/gpt-4o' },
      skills: [{ id: 'skill-a', name: 'skill-a' }],
    };
    const next = mergeAgentSpec(base, {
      skills: [{ id: 'skill-b', name: 'skill-b' }],
    });
    expect(next.skills).toEqual([{ id: 'skill-b', name: 'skill-b' }]);
  });

  it('model partial update does not clear mcpServers or skills', () => {
    const base: AgentSpec = {
      model: { type: 'fixed', name: 'openai/gpt-4o', params: { maxTokens: 1024 } },
      mcpServers: [{ id: 'github', name: 'github' }],
      skills: [{ id: 'skill-a', name: 'skill-a' }],
    };
    const next = mergeAgentSpec(base, {
      model: { type: 'fixed', name: 'anthropic/claude-sonnet-4-6' },
    });
    expect(fixedModelName(next.model)).toBe('anthropic/claude-sonnet-4-6');
    expect(modelParams(next.model)).toEqual({ maxTokens: 1024 });
    expect(next.mcpServers).toEqual(base.mcpServers);
    expect(next.skills).toEqual(base.skills);
  });
  it('replaces a fixed model with Auto and its candidates', () => {
    const base: AgentSpec = {
      model: { type: 'fixed', name: 'openai/gpt-4o', params: { maxTokens: 1024 } },
    };
    const next = mergeAgentSpec(base, {
      model: { type: 'auto', candidateModels: ['a/one', 'a/two', 'a/three', 'a/four'] },
    });
    expect(next.model).toEqual({ type: 'auto', candidateModels: ['a/one', 'a/two', 'a/three', 'a/four'] });
  });

  it('switches from Auto to a fixed model without inventing parameters', () => {
    const base: AgentSpec = {
      model: { type: 'auto', candidateModels: ['a/one', 'a/two', 'a/three', 'a/four'] },
    };
    const next = mergeAgentSpec(base, { model: { type: 'fixed', name: 'openai/gpt-4o' } });
    expect(next.model).toEqual({ type: 'fixed', name: 'openai/gpt-4o', params: undefined });
  });

  it('keeps Auto when a parameter patch arrives', () => {
    const base: AgentSpec = {
      model: { type: 'auto', candidateModels: ['a/one', 'a/two', 'a/three', 'a/four'] },
    };
    const next = mergeAgentSpec(base, { model: { params: { maxTokens: 10 } } });
    expect(next.model).toEqual(base.model);
  });
});
