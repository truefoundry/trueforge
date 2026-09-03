// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DRAFT_SPEC_PREFERENCES_STORAGE_KEY, readDraftSpecPreferences } from '@/server/draftSpecPreferences.js';
import { ServerProvider, useServerCapabilities } from '@/server/ServerContext.js';
import { ShellModeProvider, useOptionalShellMode, useShellMode, type AgentConfig } from '@/server/ShellModeContext.js';
import type { AgentUIServer } from '@/server/types.js';
import { createMockAgentUIServer } from './mockServer.js';

function wrap(agentConfig?: AgentConfig, initialSettingsOpen?: boolean) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ShellModeProvider agentConfig={agentConfig} initialSettingsOpen={initialSettingsOpen}>
        {children}
      </ShellModeProvider>
    );
  };
}

function wrapWithServer(server: AgentUIServer, agentConfig?: AgentConfig) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ServerProvider server={server}>
        <ShellModeProvider agentConfig={agentConfig}>{children}</ShellModeProvider>
      </ServerProvider>
    );
  };
}

describe('ShellModeProvider', () => {
  beforeEach(() => {
    window.localStorage.removeItem(DRAFT_SPEC_PREFERENCES_STORAGE_KEY);
  });

  it('requires a provider for useShellMode', () => {
    expect(() => renderHook(() => useShellMode())).toThrow('useShellMode must be used within a ShellModeProvider.');
  });

  it('returns null from useOptionalShellMode outside a provider', () => {
    const { result } = renderHook(() => useOptionalShellMode());

    expect(result.current).toBeNull();
  });

  it('opens settings on first paint when initialSettingsOpen is true', () => {
    const { result } = renderHook(() => useShellMode(), { wrapper: wrap(undefined, true) });
    expect(result.current.settingsOpen).toBe(true);
    expect(result.current.settingsSection).toBe('models');

    act(() => result.current.setSettingsOpen(false));
    expect(result.current.settingsOpen).toBe(false);
    act(() => result.current.openDraft());
    expect(result.current.settingsOpen).toBe(false);
  });

  it('opens settings to a requested section', () => {
    const { result } = renderHook(() => useShellMode(), { wrapper: wrap() });

    act(() => result.current.setSettingsOpen(true, 'connectors'));

    expect(result.current.settingsOpen).toBe(true);
    expect(result.current.settingsSection).toBe('connectors');
  });

  it('closes the library when settings opens and vice versa', () => {
    const { result } = renderHook(() => useShellMode(), { wrapper: wrap() });

    act(() => result.current.setLibraryOpen(true));
    expect(result.current.libraryOpen).toBe(true);
    expect(result.current.settingsOpen).toBe(false);

    act(() => result.current.setSettingsOpen(true));
    expect(result.current.settingsOpen).toBe(true);
    expect(result.current.libraryOpen).toBe(false);

    act(() => result.current.setLibraryOpen(true));
    expect(result.current.libraryOpen).toBe(true);
    expect(result.current.settingsOpen).toBe(false);
  });

  it('keeps agent config exclusive to New Agent surfaces', () => {
    const { result } = renderHook(() => useShellMode(), { wrapper: wrap() });

    act(() => result.current.openAgentBuilder());
    expect(result.current.mode).toMatchObject({ isMutable: true, isCreateAgent: true });
    expect(result.current.agentConfigOpen).toBe(true);

    act(() => result.current.setSettingsOpen(true));
    expect(result.current.agentConfigOpen).toBe(false);

    act(() => result.current.openAgentBuilder());
    expect(result.current.agentConfigOpen).toBe(true);
    act(() => result.current.selectLibraryAgent({ isMutable: false, agentName: 'support' }));
    expect(result.current.agentConfigOpen).toBe(false);
  });

  it('openDraft starts New Chat without agent config; openAgentBuilder opens config', () => {
    const { result } = renderHook(() => useShellMode(), { wrapper: wrap() });

    expect(result.current.mode).toMatchObject({ isMutable: true, isCreateAgent: false });
    expect(result.current.agentConfigOpen).toBe(false);

    act(() => result.current.openAgentBuilder());
    expect(result.current.mode).toMatchObject({ isMutable: true, isCreateAgent: true });
    expect(result.current.agentConfigOpen).toBe(true);

    act(() => result.current.openDraft());
    expect(result.current.mode).toMatchObject({ isMutable: true, isCreateAgent: false });
    expect(result.current.agentConfigOpen).toBe(false);
  });

  it('openHistorySession applies isCreateAgent only when mutable', () => {
    const { result } = renderHook(() => useShellMode(), { wrapper: wrap() });

    act(() => result.current.openHistorySession({ sessionId: 'sess-builder', isMutable: true, isCreateAgent: true }));
    expect(result.current.mode).toMatchObject({ isMutable: true, isCreateAgent: true });
    expect(result.current.agentConfigOpen).toBe(true);
    expect(result.current.pendingSessionId).toBe('sess-builder');

    act(() => result.current.openHistorySession({ sessionId: 'sess-chat', isMutable: true }));
    expect(result.current.mode).toMatchObject({ isMutable: true, isCreateAgent: false });
    expect(result.current.agentConfigOpen).toBe(false);
  });

  it('opens agent details and returns to the library list', () => {
    const { result } = renderHook(() => useShellMode(), { wrapper: wrap() });

    act(() => result.current.openLibraryAgent('agent-1'));
    expect(result.current.libraryOpen).toBe(true);
    expect(result.current.libraryAgentId).toBe('agent-1');

    act(() => result.current.closeLibraryAgent());
    expect(result.current.libraryOpen).toBe(true);
    expect(result.current.libraryAgentId).toBeNull();

    act(() => result.current.setLibraryAgentId('agent-2'));
    expect(result.current.libraryAgentId).toBe('agent-2');

    act(() => result.current.setLibraryOpen(false));
    expect(result.current.libraryOpen).toBe(false);
    expect(result.current.libraryAgentId).toBeNull();
  });

  it('defaults to AgentLibraryWithComposer (mutable + library)', () => {
    const { result } = renderHook(() => useShellMode(), { wrapper: wrap() });
    expect(result.current.mode).toMatchObject({ status: 'active', isMutable: true, locked: false });
    expect(result.current.isLibraryEnabled).toBe(true);
    expect(result.current.isComposerEnabled).toBe(true);
    expect(result.current.isNewChatEnabled).toBe(true);
  });

  it('locks SingleAgent and ignores selectAgent / openDraft', () => {
    const { result } = renderHook(() => useShellMode(), {
      wrapper: wrap({ mode: 'SingleAgent', name: 'locked' }),
    });
    expect(result.current.mode).toEqual({
      status: 'active',
      isMutable: false,
      isCreateAgent: false,
      agentId: 'locked',
      agentName: 'locked',
      locked: true,
    });
    expect(result.current.isLibraryEnabled).toBe(false);
    expect(result.current.isComposerEnabled).toBe(false);

    act(() => result.current.selectAgent('other'));
    act(() => result.current.openDraft());
    expect(result.current.mode).toEqual({
      status: 'active',
      isMutable: false,
      isCreateAgent: false,
      agentId: 'locked',
      agentName: 'locked',
      locked: true,
    });
  });

  it('starts AgentLibrary idle, then selectAgent → immutable', () => {
    const { result } = renderHook(() => useShellMode(), {
      wrapper: wrap({ mode: 'AgentLibrary' }),
    });
    expect(result.current.mode.status).toBe('idle');
    expect(result.current.isNewChatEnabled).toBe(false);
    expect(result.current.isComposerEnabled).toBe(false);
    expect(result.current.isLibraryEnabled).toBe(true);

    act(() => result.current.selectAgent('alpha'));
    expect(result.current.mode).toEqual({
      status: 'active',
      isMutable: false,
      isCreateAgent: false,
      agentId: 'alpha',
      agentName: 'alpha',
      locked: false,
    });

    const keyBefore = result.current.runtimeKey;
    act(() => result.current.clearChat());
    expect(result.current.mode.status).toBe('active');
    expect(result.current.mode).toMatchObject({ isMutable: false });
    expect(result.current.runtimeKey).not.toBe(keyBefore);
  });

  it('re-picking the current agent still changes runtimeKey', () => {
    const { result } = renderHook(() => useShellMode(), {
      wrapper: wrap({ mode: 'AgentLibrary' }),
    });

    act(() => result.current.selectAgent('alpha'));
    const keyBefore = result.current.runtimeKey;

    act(() => result.current.selectAgent('alpha'));
    expect(result.current.mode).toEqual({
      status: 'active',
      isMutable: false,
      isCreateAgent: false,
      agentId: 'alpha',
      agentName: 'alpha',
      locked: false,
    });
    expect(result.current.runtimeKey).not.toBe(keyBefore);
  });

  it('AgentComposer stays mutable; clearChat bumps epoch', () => {
    const { result } = renderHook(() => useShellMode(), {
      wrapper: wrap({
        mode: 'AgentComposer',
        defaultAgentSpec: { model: { name: 'openai-main/gpt-4.1' } },
      }),
    });
    expect(result.current.mode).toMatchObject({ status: 'active', isMutable: true });
    expect(result.current.isLibraryEnabled).toBe(false);
    expect(result.current.isComposerEnabled).toBe(true);

    act(() => result.current.selectAgent('nope'));
    expect(result.current.mode).toMatchObject({ status: 'active', isMutable: true });

    const keyBefore = result.current.runtimeKey;
    act(() => result.current.clearChat());
    expect(result.current.mode).toMatchObject({ status: 'active', isMutable: true });
    expect(result.current.runtimeKey).not.toBe(keyBefore);
  });

  it('clearChat is a no-op while idle', () => {
    const { result } = renderHook(() => useShellMode(), {
      wrapper: wrap({ mode: 'AgentLibrary' }),
    });
    const key = result.current.runtimeKey;
    act(() => result.current.clearChat());
    expect(result.current.runtimeKey).toBe(key);
    expect(result.current.mode.status).toBe('idle');
  });

  it('openDraft and selectAgent close Settings', () => {
    const { result } = renderHook(() => useShellMode(), {
      wrapper: wrap({ mode: 'AgentLibraryWithComposer' }),
    });

    act(() => result.current.setSettingsOpen(true));
    expect(result.current.settingsOpen).toBe(true);

    act(() => result.current.openDraft());
    expect(result.current.settingsOpen).toBe(false);
    expect(result.current.mode).toMatchObject({ status: 'active', isMutable: true });

    act(() => result.current.setSettingsOpen(true));
    act(() => result.current.selectAgent('alpha'));
    expect(result.current.settingsOpen).toBe(false);
    expect(result.current.mode).toEqual({
      status: 'active',
      isMutable: false,
      isCreateAgent: false,
      agentId: 'alpha',
      agentName: 'alpha',
      locked: false,
    });
  });

  it('selectLibraryAgent Edit seeds mutable binding with agentSpec', () => {
    const { result } = renderHook(() => useShellMode(), {
      wrapper: wrap({ mode: 'AgentLibraryWithComposer' }),
    });
    const spec = {
      model: { name: 'custom/model' },
      skills: [{ id: 's1', name: 'Skill' }],
      mcpServers: [{ id: 'm1', name: 'MCP' }],
    };

    act(() =>
      result.current.selectLibraryAgent({
        isMutable: true,
        agentId: 'writer',
        agentName: 'writer',
        agentSpec: spec,
      }),
    );

    expect(result.current.mode).toEqual({
      status: 'active',
      isMutable: true,
      isCreateAgent: true,
      agentId: 'writer',
      agentName: 'writer',
      agentSpec: spec,
      locked: false,
    });
  });

  it('clearChat on Edit preserves agentName and seeded agentSpec', () => {
    const { result } = renderHook(() => useShellMode(), {
      wrapper: wrap({ mode: 'AgentLibraryWithComposer' }),
    });
    const spec = {
      model: { name: 'custom/model' },
      skills: [{ id: 's1', name: 'Skill' }],
    };

    act(() =>
      result.current.selectLibraryAgent({
        isMutable: true,
        agentId: 'writer',
        agentName: 'writer',
        agentSpec: spec,
      }),
    );
    const keyBefore = result.current.runtimeKey;

    act(() => result.current.clearChat());

    expect(result.current.mode).toEqual({
      status: 'active',
      isMutable: true,
      isCreateAgent: true,
      agentId: 'writer',
      agentName: 'writer',
      agentSpec: spec,
      locked: false,
    });
    expect(result.current.runtimeKey).not.toBe(keyBefore);
  });

  it('listSessionsAgentId follows history filter when library is enabled', () => {
    const { result } = renderHook(() => useShellMode(), {
      wrapper: wrap({ mode: 'AgentLibraryWithComposer' }),
    });
    expect(result.current.listSessionsAgentId).toBeUndefined();
    expect(result.current.historyAgentFilter).toBeNull();

    act(() => result.current.setHistoryAgentFilter('from-sdk'));
    expect(result.current.historyAgentFilter).toBe('from-sdk');
    expect(result.current.listSessionsAgentId).toBe('from-sdk');

    act(() => result.current.setHistoryAgentFilter(null));
    expect(result.current.listSessionsAgentId).toBeUndefined();
  });

  it('SingleAgent locks listSessionsAgentId to the agent name', () => {
    const { result } = renderHook(() => useShellMode(), {
      wrapper: wrap({ mode: 'SingleAgent', name: 'locked' }),
    });
    expect(result.current.listSessionsAgentId).toBe('locked');
    act(() => result.current.setHistoryAgentFilter('ignored'));
    expect(result.current.listSessionsAgentId).toBe('locked');
  });

  it('openHistorySession remounts into immutable binding with pendingSessionId', () => {
    const { result } = renderHook(() => useShellMode(), {
      wrapper: wrap({ mode: 'AgentLibraryWithComposer' }),
    });
    expect(result.current.mode).toMatchObject({ status: 'active', isMutable: true });

    act(() => result.current.openHistorySession({ sessionId: 'sess-1', agentName: 'from-sdk' }));
    expect(result.current.mode).toEqual({
      status: 'active',
      isMutable: false,
      isCreateAgent: false,
      agentId: 'from-sdk',
      agentName: 'from-sdk',
      locked: false,
    });
    expect(result.current.pendingSessionId).toBe('sess-1');
    expect(result.current.runtimeKey).toContain('sess-1');
  });

  it('openHistorySession keeps immutable binding when agentName is missing', () => {
    const { result } = renderHook(() => useShellMode(), {
      wrapper: wrap({ mode: 'AgentLibraryWithComposer' }),
    });

    act(() => result.current.openHistorySession({ sessionId: 'sess-orphan', isMutable: false }));
    expect(result.current.mode).toEqual({
      status: 'active',
      isMutable: false,
      isCreateAgent: false,
      locked: false,
    });
    expect(result.current.pendingSessionId).toBe('sess-orphan');
  });

  it('openHistorySession into mutable clears Edit identity', () => {
    const { result } = renderHook(() => useShellMode(), {
      wrapper: wrap({
        mode: 'AgentLibraryWithComposer',
        defaultAgentSpec: { model: { name: 'openai-main/gpt-4.1' } },
      }),
    });

    act(() =>
      result.current.selectLibraryAgent({
        isMutable: true,
        agentId: 'writer',
        agentName: 'writer',
        agentSpec: { model: { name: 'openai-main/gpt-4.1' }, instructions: 'Write.' },
      }),
    );
    expect(result.current.mode).toMatchObject({ agentName: 'writer', isMutable: true });

    act(() => result.current.openHistorySession({ sessionId: 'sess-other', isMutable: true }));
    expect(result.current.mode).toEqual({
      status: 'active',
      isMutable: true,
      isCreateAgent: false,
      agentSpec: { model: { name: 'openai-main/gpt-4.1' } },
      locked: false,
    });
    expect(result.current.pendingSessionId).toBe('sess-other');
  });

  it('invalidateAgentsList bumps agentsListEpoch', () => {
    const { result } = renderHook(() => useShellMode(), { wrapper: wrap() });
    expect(result.current.agentsListEpoch).toBe(0);
    act(() => result.current.invalidateAgentsList());
    expect(result.current.agentsListEpoch).toBe(1);
  });

  it('bindMutableAgent attaches identity without remounting', () => {
    const { result } = renderHook(() => useShellMode(), {
      wrapper: wrap({ mode: 'AgentLibraryWithComposer' }),
    });
    const keyBefore = result.current.runtimeKey;
    const spec = {
      model: { name: 'openai-main/gpt-4.1' },
      instructions: 'Saved.',
    };

    act(() =>
      result.current.bindMutableAgent({
        agentId: 'saved',
        agentName: 'saved',
        agentSpec: spec,
      }),
    );

    expect(result.current.mode).toEqual({
      status: 'active',
      isMutable: true,
      isCreateAgent: true,
      agentId: 'saved',
      agentName: 'saved',
      agentSpec: spec,
      locked: false,
    });
    expect(result.current.runtimeKey).toBe(keyBefore);
  });

  it('bindMutableAgent keeps runtimeKey stable even when model changes', () => {
    const { result } = renderHook(() => useShellMode(), {
      wrapper: wrap({
        mode: 'AgentLibraryWithComposer',
        defaultAgentSpec: { model: { name: 'openai-main/gpt-4.1' } },
      }),
    });
    const keyBefore = result.current.runtimeKey;

    act(() =>
      result.current.bindMutableAgent({
        agentId: 'saved',
        agentName: 'saved',
        agentSpec: { model: { name: 'other/model' }, instructions: 'Saved.' },
      }),
    );

    expect(result.current.runtimeKey).toBe(keyBefore);
    expect(result.current.mode).toMatchObject({
      agentId: 'saved',
      agentName: 'saved',
      agentSpec: { model: { name: 'other/model' } },
    });
  });

  it('bindMutableAgent is a no-op when not on a mutable chat', () => {
    const { result } = renderHook(() => useShellMode(), {
      wrapper: wrap({ mode: 'AgentLibrary' }),
    });
    expect(result.current.mode.status).toBe('idle');

    act(() =>
      result.current.bindMutableAgent({
        agentId: 'x',
        agentName: 'x',
        agentSpec: { model: { name: 'openai-main/gpt-4.1' } },
      }),
    );

    expect(result.current.mode.status).toBe('idle');
  });

  it('uses remembered plain-draft preferences for the next chat', () => {
    const { result } = renderHook(() => useShellMode(), {
      wrapper: wrap({
        mode: 'AgentLibraryWithComposer',
        defaultAgentSpec: { model: { name: 'default/model' } },
      }),
    });

    act(() =>
      result.current.rememberDraftSpec({
        model: { name: 'chosen/model' },
        skills: [{ name: 'Research' }],
        mcpServers: [{ name: 'GitHub' }],
        instructions: 'Do not retain this.',
      }),
    );
    act(() => result.current.selectAgent('saved-agent'));
    act(() => result.current.openDraft());

    expect(result.current.mode).toMatchObject({
      status: 'active',
      isMutable: true,
      agentSpec: {
        model: { name: 'chosen/model' },
        skills: [{ name: 'Research' }],
        mcpServers: [{ name: 'GitHub' }],
      },
    });
    if (result.current.mode.status !== 'active') throw new Error('expected active mode');
    expect(result.current.mode.agentSpec).not.toHaveProperty('instructions');
  });

  it('preserves a host-seeded sandbox while capabilities are unavailable', () => {
    const hostSeed = { model: { name: 'chosen/model' }, config: { sandbox: { enabled: true } } };
    const { result } = renderHook(() => useShellMode(), {
      wrapper: wrap({ mode: 'AgentComposer', defaultAgentSpec: hostSeed }),
    });

    act(() => result.current.rememberDraftSpec(hostSeed));

    expect(readDraftSpecPreferences()).toEqual({
      model: { name: 'chosen/model' },
      config: { sandbox: { enabled: true } },
    });
  });

  it('does not treat sandbox availability as the selected runtime value', async () => {
    const getCapabilities = vi.fn(async () => ({
      data: {
        sandbox: { enabled: true },
        skill: { enabled: true },
      },
    }));
    const server = createMockAgentUIServer({ getCapabilities });
    const { result } = renderHook(
      () => ({
        shell: useShellMode(),
        capabilities: useServerCapabilities(),
      }),
      { wrapper: wrapWithServer(server, { mode: 'AgentComposer' }) },
    );
    await waitFor(() => expect(result.current.capabilities?.sandbox.enabled).toBe(true));

    act(() => result.current.shell.rememberDraftSpec({ model: { name: 'chosen/model' } }));

    expect(readDraftSpecPreferences()).toEqual({
      model: { name: 'chosen/model' },
    });
  });

  it('overrides a host-seeded sandbox when loaded capabilities disable it', async () => {
    const getCapabilities = vi.fn(async () => ({
      data: {
        sandbox: { enabled: false },
        skill: { enabled: false },
      },
    }));
    const server = createMockAgentUIServer({ getCapabilities });
    const { result } = renderHook(
      () => ({
        shell: useShellMode(),
        capabilities: useServerCapabilities(),
      }),
      { wrapper: wrapWithServer(server, { mode: 'AgentComposer' }) },
    );
    await waitFor(() => expect(result.current.capabilities?.sandbox.enabled).toBe(false));
    const hostSeed = { model: { name: 'chosen/model' }, config: { sandbox: { enabled: true } } };

    act(() => result.current.shell.rememberDraftSpec(hostSeed));

    expect(readDraftSpecPreferences()).toEqual({
      model: { name: 'chosen/model' },
      config: { sandbox: { enabled: false } },
    });
  });

  it('hydrates remembered preferences on first paint', () => {
    window.localStorage.setItem(
      DRAFT_SPEC_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        spec: {
          model: { name: 'remembered/model' },
          config: { sandbox: { enabled: true } },
        },
      }),
    );

    const { result } = renderHook(() => useShellMode(), {
      wrapper: wrap({
        mode: 'AgentComposer',
        defaultAgentSpec: { model: { name: 'default/model' } },
      }),
    });

    expect(result.current.mode).toMatchObject({
      status: 'active',
      isMutable: true,
      agentSpec: { model: { name: 'remembered/model' } },
    });
  });
});
