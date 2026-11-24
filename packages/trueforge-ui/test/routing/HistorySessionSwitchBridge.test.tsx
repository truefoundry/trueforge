// @vitest-environment jsdom
import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const switchToThread = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('@/assistant-ui.js', () => ({
  useAui: () => ({ threads: () => ({ switchToThread }) }),
}));

import { HistorySessionSwitchBridge } from '@/routing/HistorySessionSwitchBridge.js';
import { ServerProvider } from '@/server/ServerContext.js';
import { ShellModeProvider, useShellMode } from '@/server/ShellModeContext.js';
import { createMockAgentUIServer } from '../server/mockServer.js';

type ShellRef = { current: ReturnType<typeof useShellMode> | null };

function CaptureShell({ shellRef }: { shellRef: ShellRef }) {
  shellRef.current = useShellMode();
  return null;
}

function renderBridge(): ShellRef {
  const shellRef: ShellRef = { current: null };
  render(
    <ServerProvider server={createMockAgentUIServer()}>
      <ShellModeProvider>
        <CaptureShell shellRef={shellRef} />
        <HistorySessionSwitchBridge />
      </ShellModeProvider>
    </ServerProvider>,
  );
  if (shellRef.current == null) throw new Error('Shell context missing');
  return shellRef;
}

describe('HistorySessionSwitchBridge', () => {
  beforeEach(() => {
    switchToThread.mockClear();
  });

  it('does nothing while no history session is pending', () => {
    renderBridge();
    expect(switchToThread).not.toHaveBeenCalled();
  });

  it('switches to the opened session and re-switches on repeat opens', () => {
    const shellRef = renderBridge();

    act(() => shellRef.current?.openHistorySession({ sessionId: 'sess-1', agentName: 'from-sdk' }));
    expect(switchToThread).toHaveBeenCalledTimes(1);
    expect(switchToThread).toHaveBeenCalledWith('sess-1');

    act(() => shellRef.current?.openHistorySession({ sessionId: 'sess-1', agentName: 'from-sdk' }));
    expect(switchToThread).toHaveBeenCalledTimes(2);

    act(() => shellRef.current?.openHistorySession({ sessionId: 'sess-2', isMutable: true }));
    expect(switchToThread).toHaveBeenLastCalledWith('sess-2');
  });
});
