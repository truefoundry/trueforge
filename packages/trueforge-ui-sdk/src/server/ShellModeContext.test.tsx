// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { ShellModeProvider, useShellMode, type AgentConfig } from './ShellModeContext.js';

function wrap(agentConfig?: AgentConfig) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <ShellModeProvider agentConfig={agentConfig}>{children}</ShellModeProvider>;
  };
}

describe('ShellModeProvider', () => {
  it('defaults to AgentLibraryWithComposer (draft + library)', () => {
    const { result } = renderHook(() => useShellMode(), { wrapper: wrap() });
    expect(result.current.mode.type).toBe('draft');
    expect(result.current.isLibraryEnabled).toBe(true);
    expect(result.current.isComposerEnabled).toBe(true);
    expect(result.current.isNewChatEnabled).toBe(true);
  });

  it('locks SingleAgent and ignores selectAgent / openDraft', () => {
    const { result } = renderHook(() => useShellMode(), {
      wrapper: wrap({ mode: 'SingleAgent', name: 'locked' }),
    });
    expect(result.current.mode).toEqual({
      type: 'named',
      agentName: 'locked',
      locked: true,
    });
    expect(result.current.isLibraryEnabled).toBe(false);
    expect(result.current.isComposerEnabled).toBe(false);

    act(() => result.current.selectAgent('other'));
    act(() => result.current.openDraft());
    expect(result.current.mode).toEqual({
      type: 'named',
      agentName: 'locked',
      locked: true,
    });
  });

  it('starts AgentLibrary idle, then selectAgent → named', () => {
    const { result } = renderHook(() => useShellMode(), {
      wrapper: wrap({ mode: 'AgentLibrary' }),
    });
    expect(result.current.mode.type).toBe('idle');
    expect(result.current.isNewChatEnabled).toBe(false);
    expect(result.current.isComposerEnabled).toBe(false);
    expect(result.current.isLibraryEnabled).toBe(true);

    act(() => result.current.selectAgent('alpha'));
    expect(result.current.mode).toEqual({
      type: 'named',
      agentName: 'alpha',
      locked: false,
    });

    const keyBefore = result.current.runtimeKey;
    act(() => result.current.clearChat());
    expect(result.current.mode.type).toBe('named');
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
      type: 'named',
      agentName: 'alpha',
      locked: false,
    });
    expect(result.current.runtimeKey).not.toBe(keyBefore);
  });

  it('AgentComposer stays draft; clearChat bumps draft epoch', () => {
    const { result } = renderHook(() => useShellMode(), {
      wrapper: wrap({
        mode: 'AgentComposer',
        defaultAgentSpec: { model: { name: 'openai-main/gpt-4.1' } },
      }),
    });
    expect(result.current.mode.type).toBe('draft');
    expect(result.current.isLibraryEnabled).toBe(false);
    expect(result.current.isComposerEnabled).toBe(true);

    act(() => result.current.selectAgent('nope'));
    expect(result.current.mode.type).toBe('draft');

    const keyBefore = result.current.runtimeKey;
    act(() => result.current.clearChat());
    expect(result.current.mode.type).toBe('draft');
    expect(result.current.runtimeKey).not.toBe(keyBefore);
  });

  it('clearChat is a no-op while idle', () => {
    const { result } = renderHook(() => useShellMode(), {
      wrapper: wrap({ mode: 'AgentLibrary' }),
    });
    const key = result.current.runtimeKey;
    act(() => result.current.clearChat());
    expect(result.current.runtimeKey).toBe(key);
    expect(result.current.mode.type).toBe('idle');
  });

  it('openDraft and selectAgent close Settings', () => {
    const { result } = renderHook(() => useShellMode(), {
      wrapper: wrap({ mode: 'AgentLibraryWithComposer' }),
    });

    act(() => result.current.setSettingsOpen(true));
    expect(result.current.settingsOpen).toBe(true);

    act(() => result.current.openDraft());
    expect(result.current.settingsOpen).toBe(false);
    expect(result.current.mode.type).toBe('draft');

    act(() => result.current.setSettingsOpen(true));
    act(() => result.current.selectAgent('alpha'));
    expect(result.current.settingsOpen).toBe(false);
    expect(result.current.mode).toEqual({
      type: 'named',
      agentName: 'alpha',
      locked: false,
    });
  });
});
