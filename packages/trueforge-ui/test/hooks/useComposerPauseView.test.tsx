// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useAuiState = vi.hoisted(() => vi.fn());
const useToolResponses = vi.hoisted(() => vi.fn());

vi.mock('@assistant-ui/react', () => ({
  useAuiState,
}));

vi.mock('@truefoundry/assistant-ui-runtime', () => ({
  useTrueFoundryToolResponses: useToolResponses,
}));

import { threadHasPendingMcpAuth, type ThreadPauseState, useComposerPauseView } from '@/hooks/useComposerPauseView.js';
import { CustomActionRenderersProvider } from '@/server/CustomActionRenderersContext.js';

function withRenderers(renderers: Record<string, () => null>) {
  return ({ children }: { children: ReactNode }) => (
    <CustomActionRenderersProvider renderers={renderers}>{children}</CustomActionRenderersProvider>
  );
}

describe('threadHasPendingMcpAuth', () => {
  it('recognizes MCP authorization only on the latest requiring-action assistant message', () => {
    const pendingState = {
      thread: {
        messages: [
          { role: 'user' },
          {
            role: 'assistant',
            status: { type: 'requires-action' },
            metadata: { custom: { pendingMcpAuth: true } },
          },
        ],
      },
    } satisfies ThreadPauseState;

    expect(threadHasPendingMcpAuth(pendingState)).toBe(true);
    expect(
      threadHasPendingMcpAuth({
        thread: {
          messages: [...pendingState.thread.messages, { role: 'user' }],
        },
      }),
    ).toBe(false);
  });

  it('rejects assistant messages without both the required status and metadata flag', () => {
    expect(
      threadHasPendingMcpAuth({
        thread: {
          messages: [
            {
              role: 'assistant',
              status: { type: 'running' },
              metadata: { custom: { pendingMcpAuth: true } },
            },
          ],
        },
      }),
    ).toBe(false);
    expect(
      threadHasPendingMcpAuth({
        thread: {
          messages: [
            {
              role: 'assistant',
              status: { type: 'requires-action' },
              metadata: { custom: { pendingMcpAuth: false } },
            },
          ],
        },
      }),
    ).toBe(false);
    expect(threadHasPendingMcpAuth({ thread: { messages: [] } })).toBe(false);
  });
});

describe('useComposerPauseView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuiState.mockReturnValue(false);
    useToolResponses.mockReturnValue({ pending: [] });
  });

  it('returns the normal composer when no pause source is pending', () => {
    const { result } = renderHook(() => useComposerPauseView());

    expect(result.current).toEqual({ kind: 'compose' });
    expect(useAuiState).toHaveBeenCalledWith(threadHasPendingMcpAuth);
  });

  it('shows the ask-user view while tool responses are pending without a custom renderer', () => {
    useToolResponses.mockReturnValue({ pending: [{ toolCallId: 'question-1', toolName: 'ask_user_question' }] });

    const { result } = renderHook(() => useComposerPauseView());

    expect(result.current).toEqual({ kind: 'ask-user' });
  });

  it('shows the custom view when the pending tool name is registered', () => {
    useToolResponses.mockReturnValue({
      pending: [{ toolCallId: 'tc-1', toolName: 'secret_select', args: {} }],
    });

    const { result } = renderHook(() => useComposerPauseView(), {
      wrapper: withRenderers({ secret_select: () => null }),
    });

    expect(result.current).toEqual({ kind: 'custom', toolName: 'secret_select' });
  });

  it('falls back to ask-user when a pending tool is not in the custom map', () => {
    useToolResponses.mockReturnValue({
      pending: [{ toolCallId: 'tc-1', toolName: 'secret_select', args: {} }],
    });

    const { result } = renderHook(() => useComposerPauseView(), {
      wrapper: withRenderers({ other_tool: () => null }),
    });

    expect(result.current).toEqual({ kind: 'ask-user' });
  });

  it('gives MCP authorization precedence over pending tool responses', () => {
    useAuiState.mockReturnValue(true);
    useToolResponses.mockReturnValue({
      pending: [{ toolCallId: 'question-1', toolName: 'secret_select' }],
    });

    const { result } = renderHook(() => useComposerPauseView(), {
      wrapper: withRenderers({ secret_select: () => null }),
    });

    expect(result.current).toEqual({ kind: 'mcp' });
  });

  it('gives custom renderers precedence over ask-user for the same pending tool', () => {
    useToolResponses.mockReturnValue({
      pending: [{ toolCallId: 'question-1', toolName: 'ask_user_question', question: 'Continue?' }],
    });

    const { result } = renderHook(() => useComposerPauseView(), {
      wrapper: withRenderers({ ask_user_question: () => null }),
    });

    expect(result.current).toEqual({ kind: 'custom', toolName: 'ask_user_question' });
  });
});
