import { describe, expect, it } from 'vitest';

import { hasAgentSpecEdits } from '@/atoms/lib/hasAgentSpecEdits.js';
import type { AgentSpec } from '@/server/types.js';

const saved: AgentSpec = {
  model: { name: 'openai/gpt-4.1' },
  instructions: 'Be brief.',
  mcpServers: [{ name: 'github', tools: ['get_commit'] }],
};

describe('hasAgentSpecEdits', () => {
  it('is false for an identical spec regardless of key order or empty fields', () => {
    const live: AgentSpec = {
      mcpServers: [{ tools: ['get_commit'], name: 'github' }],
      instructions: 'Be brief.',
      model: { name: 'openai/gpt-4.1' },
      skills: [],
    };
    expect(hasAgentSpecEdits({ saved, live })).toBe(false);
  });

  it('treats missing instructions and empty instructions as the same', () => {
    const base: AgentSpec = { model: { name: 'openai/gpt-4.1' } };
    expect(hasAgentSpecEdits({ saved: base, live: { ...base, instructions: '' } })).toBe(false);
  });

  it('detects a changed MCP tool selection', () => {
    const live: AgentSpec = { ...saved, mcpServers: [{ name: 'github', tools: ['get_commit', 'get_tag'] }] };
    expect(hasAgentSpecEdits({ saved, live })).toBe(true);
  });

  it('detects changed instructions and model', () => {
    expect(hasAgentSpecEdits({ saved, live: { ...saved, instructions: 'Be verbose.' } })).toBe(true);
    expect(hasAgentSpecEdits({ saved, live: { ...saved, model: { name: 'openai/gpt-5' } } })).toBe(true);
  });

  it('ignores runtime config toggles that are reconciled automatically', () => {
    const live: AgentSpec = { ...saved, config: { sandbox: { enabled: true } } };
    expect(hasAgentSpecEdits({ saved, live })).toBe(false);
  });
});
