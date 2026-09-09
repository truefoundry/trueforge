// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  useChatChromeActionsVisible,
  useChatHeaderContentVisible,
  useNamedAgentHeaderVisible,
  useSaveAgentVisible,
} from '@/hooks/useChatChromeActionsVisible.js';
import { ShellModeProvider, useShellMode } from '@/server/ShellModeContext.js';
import { RuntimeHarness } from '../containers/RuntimeHarness.js';

vi.mock('@truefoundry/assistant-ui-runtime', () => ({
  useTrueFoundryAgentSpec: () => ({
    agentSpec: {},
  }),
}));

const startedMessages = [{ role: 'user' as const, content: 'hello', id: 'm1' }];

function wrap({
  messages = startedMessages,
  agentConfig,
}: {
  messages?: typeof startedMessages | [];
  agentConfig?: Parameters<typeof ShellModeProvider>[0]['agentConfig'];
}) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ShellModeProvider agentConfig={agentConfig}>
        <RuntimeHarness messages={messages}>{children}</RuntimeHarness>
      </ShellModeProvider>
    );
  };
}

describe('useChatHeaderContentVisible', () => {
  it('stays true when only Clear Chat is visible (orphaned immutable history)', () => {
    const { result } = renderHook(
      () => {
        const shell = useShellMode();
        return {
          shell,
          named: useNamedAgentHeaderVisible(),
          save: useSaveAgentVisible(),
          clear: useChatChromeActionsVisible(),
          header: useChatHeaderContentVisible(),
        };
      },
      { wrapper: wrap({ agentConfig: { mode: 'AgentLibraryWithComposer' } }) },
    );

    act(() => {
      result.current.shell.openHistorySession({ sessionId: 'sess-orphan', isMutable: false });
    });

    expect(result.current.named).toBe(false);
    expect(result.current.save).toBe(false);
    expect(result.current.clear).toBe(true);
    expect(result.current.header).toBe(true);
  });

  it('shows New Chat header on mutable drafts; Clear is visible', () => {
    const { result } = renderHook(
      () => ({
        named: useNamedAgentHeaderVisible(),
        save: useSaveAgentVisible(),
        clear: useChatChromeActionsVisible(),
        header: useChatHeaderContentVisible(),
      }),
      {
        wrapper: wrap({
          agentConfig: { mode: 'AgentComposer' },
        }),
      },
    );

    expect(result.current.named).toBe(true);
    expect(result.current.save).toBe(false);
    expect(result.current.clear).toBe(true);
    expect(result.current.header).toBe(true);
  });

  it('hides Clear on a fresh draft; header still shows the title', () => {
    const { result } = renderHook(
      () => ({
        clear: useChatChromeActionsVisible(),
        header: useChatHeaderContentVisible(),
      }),
      { wrapper: wrap({ messages: [], agentConfig: { mode: 'AgentComposer' } }) },
    );

    expect(result.current.clear).toBe(false);
    expect(result.current.header).toBe(true);
  });
});
