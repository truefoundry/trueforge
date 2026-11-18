// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UnsavedAgentChangesBridge } from '@/atoms/draft/UnsavedAgentChangesBridge.js';
import type { AgentSpec } from '@/server/types.js';

const saved: AgentSpec = { model: { name: 'openai/gpt-4.1' }, mcpServers: [{ name: 'github', tools: ['get_commit'] }] };
let live: AgentSpec;
let mode: { status: 'active'; isMutable: boolean; isCreateAgent: boolean; agentSpec: AgentSpec };
const setHasUnsavedAgentChanges = vi.fn();

vi.mock('@truefoundry/trueforge-assistant-ui-runtime', () => ({
  useTrueForgeAgentSpec: () => ({ agentSpec: live, isSpecLoading: false }),
}));

vi.mock('@/server/ShellModeContext.js', () => ({
  useShellMode: () => ({ mode, setHasUnsavedAgentChanges }),
}));

describe('UnsavedAgentChangesBridge', () => {
  beforeEach(() => {
    setHasUnsavedAgentChanges.mockClear();
    live = saved;
    mode = { status: 'active', isMutable: true, isCreateAgent: true, agentSpec: saved };
  });

  it('reports a clean builder', () => {
    render(<UnsavedAgentChangesBridge />);
    expect(setHasUnsavedAgentChanges).toHaveBeenLastCalledWith(false);
  });

  it('reports unsaved changes when the MCP tools differ from the saved agent', () => {
    live = { ...saved, mcpServers: [{ name: 'github', tools: ['get_commit', 'get_tag'] }] };
    render(<UnsavedAgentChangesBridge />);
    expect(setHasUnsavedAgentChanges).toHaveBeenLastCalledWith(true);
  });

  it('never reports changes outside the agent builder', () => {
    live = { ...saved, instructions: 'edited' };
    mode = { ...mode, isCreateAgent: false };
    render(<UnsavedAgentChangesBridge />);
    expect(setHasUnsavedAgentChanges).toHaveBeenLastCalledWith(false);
  });

  it('clears the flag when the builder unmounts', () => {
    live = { ...saved, instructions: 'edited' };
    const { unmount } = render(<UnsavedAgentChangesBridge />);
    expect(setHasUnsavedAgentChanges).toHaveBeenLastCalledWith(true);
    unmount();
    expect(setHasUnsavedAgentChanges).toHaveBeenLastCalledWith(false);
  });
});
